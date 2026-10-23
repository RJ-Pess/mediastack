// Indexador Torznab falso para testes: devolve sempre o mesmo "release" e um .torrent
// de brincadeira (sem tracker, sem peers, sem conteúdo real). Nunca descarrega nada.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const TITLE = process.env.MOCK_RELEASE ?? 'Night.of.the.Living.Dead.1968.1080p.WEB-DL.x264-CAIS';
const SIZE = 2 * 1024 ** 3; // anunciado ao Radarr; o .torrent não corresponde a dados reais
const PORT = Number(process.env.PORT ?? 9000);

const bstr = (s) => Buffer.concat([Buffer.from(`${Buffer.byteLength(s)}:`), Buffer.from(s)]);
const bint = (n) => Buffer.from(`i${n}e`);
function torrent() {
  const pieceLen = 262144;
  const length = pieceLen * 2;
  const pieces = Buffer.concat([0, 1].map((i) => createHash('sha1').update(`cais-${i}`).digest()));
  const info = Buffer.concat([
    Buffer.from('d'), bstr('length'), bint(length), bstr('name'), bstr(TITLE),
    bstr('piece length'), bint(pieceLen), bstr('pieces'), Buffer.from(`${pieces.length}:`), pieces, Buffer.from('e'),
  ]);
  return Buffer.concat([Buffer.from('d'), bstr('info'), info, Buffer.from('e')]);
}

const caps = `<?xml version="1.0" encoding="UTF-8"?>
<caps><server title="Cais mock"/><limits max="100" default="50"/>
<searching><search available="yes" supportedParams="q"/><tv-search available="yes" supportedParams="q,season,ep"/><movie-search available="yes" supportedParams="q,imdbid"/></searching>
<categories><category id="2000" name="Movies"><subcat id="2040" name="Movies/HD"/></category><category id="5000" name="TV"><subcat id="5040" name="TV/HD"/></category></categories></caps>`;

const feed = (base) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><title>Cais mock</title>
<item><title>${TITLE}</title><guid>cais-mock-1</guid><pubDate>${new Date().toUTCString()}</pubDate>
<link>${base}/download/test.torrent</link><size>${SIZE}</size>
<enclosure url="${base}/download/test.torrent" length="${SIZE}" type="application/x-bittorrent"/>
<torznab:attr name="category" value="2040"/><torznab:attr name="seeders" value="50"/><torznab:attr name="peers" value="55"/>
<torznab:attr name="size" value="${SIZE}"/></item></channel></rss>`;

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const base = `http://${req.headers.host}`;
  if (url.pathname === '/download/test.torrent') {
    res.writeHead(200, { 'Content-Type': 'application/x-bittorrent' }).end(torrent());
  } else if (url.pathname === '/api') {
    res.writeHead(200, { 'Content-Type': 'application/xml' }).end(url.searchParams.get('t') === 'caps' ? caps : feed(base));
  } else {
    res.writeHead(404).end();
  }
}).listen(PORT, () => console.log(`mock indexer em :${PORT}`));
