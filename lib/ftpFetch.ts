import { Client as FtpClient } from 'basic-ftp';
import SftpClient from 'ssh2-sftp-client';
import { Writable } from 'stream';

export type RemoteConfig = {
  protocol: 'ftp' | 'ftps' | 'sftp';
  host: string;
  port?: number | null;
  user: string;
  password: string;
  path?: string | null; // archivo exacto (termina en .csv) o carpeta. Vacío = raíz
};

function joinPath(dir: string, name: string) {
  if (!dir || dir === '/') return `/${name}`;
  return `${dir.replace(/\/$/, '')}/${name}`;
}

/**
 * Se conecta al servidor del proveedor y descarga el CSV.
 * - Si `path` termina en .csv, descarga ese archivo.
 * - Si no, busca el .csv más reciente en esa carpeta (o en la raíz).
 */
export async function fetchRemoteCsv(cfg: RemoteConfig): Promise<{ filename: string; text: string }> {
  const target = (cfg.path || '').trim();
  const isExactFile = /\.csv$/i.test(target);
  const dir = isExactFile ? '' : target || '/';

  if (cfg.protocol === 'sftp') {
    const sftp = new SftpClient();
    try {
      await sftp.connect({
        host: cfg.host,
        port: cfg.port || 22,
        username: cfg.user,
        password: cfg.password,
        readyTimeout: 15000,
      });
      let remotePath = target;
      if (!isExactFile) {
        const list = await sftp.list(dir);
        const csvs = list
          .filter((f) => f.type === '-' && /\.csv$/i.test(f.name))
          .sort((a, b) => b.modifyTime - a.modifyTime);
        if (csvs.length === 0) throw new Error(`No se encontró ningún .csv en "${dir}".`);
        remotePath = joinPath(dir, csvs[0].name);
      }
      const data = (await sftp.get(remotePath)) as Buffer;
      return { filename: remotePath.split('/').pop() || 'inventario.csv', text: data.toString('utf8') };
    } finally {
      await sftp.end().catch(() => {});
    }
  }

  const client = new FtpClient(20000);
  try {
    await client.access({
      host: cfg.host,
      port: cfg.port || 21,
      user: cfg.user,
      password: cfg.password,
      secure: cfg.protocol === 'ftps',
    });

    let remotePath = target;
    if (!isExactFile) {
      const list = await client.list(dir);
      const csvs = list
        .filter((f) => f.isFile && /\.csv$/i.test(f.name))
        .sort((a, b) => (b.modifiedAt?.getTime() ?? 0) - (a.modifiedAt?.getTime() ?? 0));
      if (csvs.length === 0) throw new Error(`No se encontró ningún .csv en "${dir}".`);
      remotePath = joinPath(dir, csvs[0].name);
    }

    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    await client.downloadTo(sink, remotePath);
    return { filename: remotePath.split('/').pop() || 'inventario.csv', text: Buffer.concat(chunks).toString('utf8') };
  } finally {
    client.close();
  }
}
