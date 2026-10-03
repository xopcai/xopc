# 小环 v3 · 造型发散、调研与实现

2026-10-03。用户反馈：动画机械、人物歪斜、外圈像气球。目标是年轻、有趣、可爱、有情绪价值，并保持简洁精致。

## 调研证据与设计判断

1. [Duolingo：How Duolingo Animates Its World Characters](https://blog.duolingo.com/world-character-visemes/)：通过口型设计、动画状态衔接等方式组织角色表演。启发是把局部表情独立出来。本文不代表 Duolingo 推荐了我们的具体动作参数。
2. [Rive：Features](https://rive.app/features)：提供状态机分层及动画混合。本轮用分层 SVG 和独立弹簧实现这一组织方式，没有导出 .riv 文件。
3. [Apple：Motion](https://developer.apple.com/design/human-interface-guidelines/motion)：动态反馈应简短准确，避免不必要的重复，并允许取消。对应一次性的轻点回应与完成小跳、暂停和系统减少动态效果。
4. [Apple：Materials](https://developer.apple.com/design/human-interface-guidelines/materials)：材质服务于层次和功能，Liquid Glass 应克制使用。陶瓷角色是我们的艺术判断，不是 Apple 的吉祥物材质规定。

## 三种发散方向

| 方向 | 可取之处 | 取舍 |
| --- | --- | --- |
| A 薄陶瓷 | 平整、精确、触感温和，灰蓝辨识度清楚 | 本轮采用，细边高光与 3 单位浅侧边 |
| B 磨砂玻璃 | 轻盈、通透 | 小尺寸对比不足，容易再次依赖高光 |
| C 层叠纸片 | 亲切、柔和、适合平面传播 | 主角色精密感较弱，可留作贴纸支线 |

material-directions.png 是内置 imagegen 生成的材质探索板。其闭合圆环、粗纹理、色彩偏淡未直接用于交互角色。运行时使用重新绘制的可编辑 SVG。

## 落地变化

- 外环使用浅侧边、窄边高光和低对比平面渐变，没有圆管高光或鼓起的表面。
- 白色核心为扁圆形，两眼同一水平线。核心与脸部均不旋转，只有外环小幅跟随。
- 眼神弹簧最快、核心其次、外环最慢，各层有不同阻尼。无交互时回中，偶尔侧看一下再收回。
- 眨眼间隔 2.8–6.6 秒，约 18% 概率双眨眼；休息和笑眼不叠加眨眼。
- 轻触短暂单眼眨眼、淡脸颊色和核心微形变；完成先压低，再小跳、落定。陶瓷环不拉伸。
- 脸部和嘴部独立过渡，八个状态可切换；缩略图来自同一套 SVG。
- 时间用同一个活动时钟；暂停、后台和角色滚出视口时停止推进，回来不追赶跳帧。
- 官网为循环理念演示，Onboarding 在决策阶段等待用户点击。减少动态效果时停用追踪、眨眼和循环，提供“下一步”手动阅读。

## 交付范围

preview.html / preview.css / preview.js 是可离线打开、无外部运行库的交互样稿。旧版存档为 preview-v2.html；原 PNG 设计板继续保留供比较。尚未替换正式 App、官网角色或 Logo。

## 本轮图像生成提示词

工具：内置 image_gen。新图生成，无旧角色位图约束，避免沿用充气造型。

Use case: logo-brand. Create a premium character art direction exploration board for xopc, a youthful personal AI companion. Three columns labeled only A / CERAMIC, B / FROST, C / PAPER. Warm ivory background, beautifully art directed product design presentation, full character centered in each column, generous whitespace, NOT a website screenshot.
Common character anatomy: an open circular annular FLAT BAND holding a small floating soft ivory oval face disk within its empty center. Outer band is 80 percent graphite with small blue 20 percent segment at upper right. Both eye centers perfectly horizontal, face looking straight ahead, NOT tilted, two simple tiny dark eyes and a subtle small curved smile. Face disk has ample breathing room from ring. No legs, hands, gloves or accessories.
A: precisely machined graphite ceramic annular plate, broad FLAT front surface, very shallow depth, almost square cross section with delicately softened edges, narrow edge highlight only. Restrained blue enamel segment. Warm opaque ivory oval face disk, soft matte surface. Sculptural, elegant, very cute through face.
B: ultra thin satin frosted smoke glass annular plate, a blue translucent inlay, pearl ivory face disk; more airy and translucent but no neon and no glossy glass ball.
C: warm graphic layered paper annulus, dark graphite, blue arc and ivory disk. Minimal relief, soft tiny shadows, refined editorial character.
Important: ring is a thin washer / annular plate, NOT a torus, not a tube, not a balloon or inflated swimming ring. No inflated bulging surface. No shiny plastic, broad specular stripes, glowing halo, metallic chrome, sphere face, anime eyes, stock robot. All three should feel calm, expressive and lovable, suitable for young adults. Simple eye shapes and matte materials. No distracting text other than the three short column labels.

