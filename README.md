# 极简决斗

## 双设备 / 双页面

```bash
cd ~/projects/duel
node server.js
```

终端会打印本机和局域网的地址。打开两个页面:

- 电脑两个标签页:`http://localhost:3000/?seat=0` 和 `http://localhost:3000/?seat=1`
- 手机:把 `localhost` 换成启动时打印的局域网 IP(WireGuard 下通常是 `10.77.0.2`),`?seat=0` / `?seat=1` 各开一个

服务器持有权威状态,双方选完后同时结算。第三个页面会自动成为观众。端口被占用时用 `PORT=3001 node server.js`。

手机连不上时,确认手机能访问电脑的地址,并且防火墙放行对应端口。

## 本地热座

直接用浏览器打开 `hotseat.html`,同一台设备轮流秘密选招。

## 规则

- 蓄力:+1 EN;防御:本回合受击 −1(一次);攻击:−1 EN 造成 1;大招:−5 EN 造成 2
- 双方同时选招、同时结算;互相攻击的双方逐点抵消
- 汇总每个玩家的受击值,减去防御值,得到扣血值;血量归零即败

## 文件

- `index.html` / `app.js` / `style.css` — 双屏客户端
- `engine.js` — 共享结算引擎(浏览器与 Node 共用)
- `server.js` — HTTP + SSE 同步服务,无第三方依赖
- `hotseat.html` — 旧版单文件热座

## 公网部署（可选）

```bash
ACCESS_TOKEN=<随机串> PORT=34871 node server.js
```

链接形如 `http://<公网IP>:34871/?room=<随机串>&seat=0`（`seat=1` 给另一台）。建议用 systemd user 服务常驻，并在云安全组和主机防火墙放行该端口。不带 `room` 的页面和 API 请求会返回 404。
