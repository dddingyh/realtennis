# Real Tennis（像素网球）

网页端像素风网球游戏：镜头位于底线后方的转播视角，带真实感的球体物理，AI 对手有不同的战术风格，还可以把**手机当作体感球拍**来玩。

## 运行

纯静态网站，无需构建：

```bash
python3 -m http.server 8000
```

然后打开 <http://localhost:8000/>。

**手机体感需要 HTTPS**（浏览器只在安全上下文中开放陀螺仪/加速度计），所以要把仓库部署到 GitHub Pages 或其他 HTTPS 静态托管后，再用手机扫描游戏里显示的二维码。手柄的握法、校准和排障见 [docs/CONTROLLER.md](docs/CONTROLLER.md)。

## 玩法

- **键盘**：WASD / 方向键移动；`J` 上旋、`K` 平击、`L` 切削、`I` 挑高（按下引拍，松开击球，按住时间 = 力量）；击球瞬间按住方向键控制落点；空格发球；`Esc`/`P` 暂停。
- **手机体感**：倾斜手机控制走位（默认开启自动跑位辅助）；挥动手机击球，自动识别正/反手和平击/上旋/切削/挑高；击球早晚决定方向（早 → 斜线，晚 → 直线）。
- **位置决定击球效果**：站位（底线后/场内/网前）、击球点高度、离身体的距离、跑动中击球、来球的速度和旋转、用错正反手，都会影响球速、角度、旋转和失误率。

## 物理

二次方空气阻力、马格努斯力（升力系数与自旋参数相关）、旋转衰减；落地反弹采用冲量模型（垂直恢复系数 + 接触点库仑摩擦，区分滑动与滚动），所以上旋球弹得高、往前冲，切削球低平；红土弹得高且慢，草地低且快。另外模拟了球网碰撞和擦网。所有击球都由求解器根据物理轨迹反算发射角，出界和下网是物理模拟的自然结果，不是脚本设定。

## AI 风格

底线型（grinder）、进攻型（aggressive）、发球上网（serveVolley）、防守反击（counter）。难度会影响反应时间、预判误差和决策质量；AI 会记录你哪一侧更容易失误，并针对这一侧打。

## 目录

| 路径 | 内容 |
|---|---|
| `src/physics`, `src/game` | 物理、击球模型、球员、AI、计分（不依赖 DOM，可在 Node 中测试） |
| `src/render`, `src/ui`, `src/audio` | 程序生成的像素美术（SDF 角色、球场/看台）、HUD、菜单、合成音效 |
| `src/controller`, `src/net`, `src/input/remote.js` | 手机手柄、挥拍识别、PeerJS / BroadcastChannel 通信 |
| `docs/DESIGN.md` | 模块之间的接口约定 |
| `vendor/` | PeerJS 1.5.4、qrcode-generator 1.4.4（MIT） |

## 测试

```bash
for t in tests/sim_*.mjs tests/gesture.test.mjs tests/net.test.mjs; do node "$t" || echo "FAIL $t"; done
```

```bash
node tests/e2e.mjs
```

`e2e.mjs` 需要本机已安装 Playwright 和 Chromium。

## 已知限制

- 挥拍识别的阈值是用合成传感器数据调的，换到真机上的准确率还没验证过，建议先做手柄里的“挥拍校准”。
- 手机和电脑之间通过 PeerJS 公共信令服务器建立 WebRTC 连接，在对称 NAT 或公司网络下可能连不上（这种情况需要自建 TURN 服务器）。
- iOS Safari 不支持震动反馈。
