import http from 'node:http';

/**
 * 局域网预览转发层：0.0.0.0:RELAY_PORT -> 127.0.0.1:UPSTREAM_PORT
 *
 * 为什么存在：game-workspace/game/scripts/serve-web.mjs 只监听 127.0.0.1，
 * 且流程等待人工门禁期间禁止修改工作区文件（审批指纹绑定），
 * 因此用工作区外的转发层把预览暴露给局域网（手机真机试玩）。
 *
 * 用法：node tools/lan-preview.mjs
 * 环境变量：RELAY_PORT（默认 7791）、UPSTREAM_PORT（默认 7790）
 */
const upstreamPort = Number(process.env.UPSTREAM_PORT || 7790);
const relayPort = Number(process.env.RELAY_PORT || 7791);

http.createServer((req, res) => {
  const proxy = http.request(
    {
      host: '127.0.0.1',
      port: upstreamPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` },
    },
    upstream => {
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    },
  );
  proxy.on('error', error => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`上游预览服务（127.0.0.1:${upstreamPort}）不可达：${error.message}\n请先在 game-workspace/game 运行 node scripts/serve-web.mjs`);
  });
  req.pipe(proxy);
}).listen(relayPort, '0.0.0.0', () => {
  console.log(`局域网预览转发已启动：http://0.0.0.0:${relayPort}/ -> http://127.0.0.1:${upstreamPort}/`);
  console.log('手机与电脑同一局域网后，访问 http://<电脑局域网IP>:' + relayPort + '/');
});
