# Qwixx（快可思）规则调研报告

**面向对象**：电子版实现与 AI 训练环境开发工程师
**游戏信息**：Qwixx，作者 Steffen Benndorf，原版出版社 Nürnberger-Spielkarten-Verlag（NSV，2012），英文版 Gamewright（2014）；2–5 人，8 岁以上，约 15 分钟。BGG 条目：[Qwixx](https://boardgamegeek.com/boardgame/131260/qwixx)。
**一手来源**：本报告的基础版与各扩展规则均直接取自官方规则 PDF 全文（Gamewright 英文规则、NSV 官方英文规则及各扩展英文规则），并逐条核对；来源链接见文末。

---

## 1. 基础版规则（2–5 人）

### 1.1 配件与计分表

- **6 枚骰子**：2 白 + 红、黄、绿、蓝各 1（均为标准 d6）。
- **计分表（每人一张）**，含四条颜色行：
  - 红行：`2 3 4 5 6 7 8 9 10 11 12`（从左到右升序）
  - 黄行：`2 3 4 5 6 7 8 9 10 11 12`（升序）
  - 绿行：`12 11 10 9 8 7 6 5 4 3 2`（从左到右降序）
  - 蓝行：`12 11 10 9 8 7 6 5 4 3 2`（降序）
  - 每行最右端数字（红 12、黄 12、绿 2、蓝 2）右侧有一个**锁定符号格**。
  - 表下方为分数换算表和 4 个失误（penalty/misthrow）格。

### 1.2 唯一的基本划记规则

官方原文（Gamewright）："numbers must be crossed out from left to right in each of the four color-rows"。

- 每行内**只能从左往右**划：新划的格子必须在该行所有已划格子的**右侧**。
- 不必从最左端开始，可以跳过任意多个格子；**跳过的格子此后永远不能再划**。
- 每个格子最多划一次。

> 实现要点：每行的状态可压缩为「已划格子的位置集合 + 最右已划位置 rightmost」；合法划记条件是 `目标位置 > rightmost` 且该行未锁定（且满足锁定行的特殊条件，见 1.5）。

### 1.3 回合流程（两步动作，严格有序）

随机/掷骰决定首个"主动玩家"（Gamewright 版：先掷出 6 者；NSV 版：抽签）。主动玩家掷**全部 6 枚骰子**，然后**依次**执行两步动作（官方强调 "carried out in order, always one after the other"，即先 1 后 2，不可颠倒）：

**动作 1（白骰和，所有人可用）**
主动玩家把**两枚白骰求和**并大声报出。**所有玩家**（含主动玩家）都**可以但不必**把这个和数划在自己任意一条（**且只能一条**）颜色行中。

- 两白骰**只能求和使用，不能分开各当一个数用**（规则只定义了"和"这一种用法）。
- 各玩家的选择相互独立、可同时进行，选择互不影响。

**动作 2（白+彩组合，仅主动玩家可用）**
**只有主动玩家**可以（但不必）把**一枚白骰**（两枚中任选其一）与**一枚彩骰**（四枚中任选其一）求和，把该和数划在**与所选彩骰颜色相同**的行中。

- 非主动玩家在动作 2 中什么都不能做。
- 若主动玩家在两步中都划了，则本回合划 2 格；两格可以在不同行，也可以在**同一行**（此时第二格必须在第一格右侧——由左到右规则自动约束，相邻推进是合法的）；不能是同一个格子（一格只能划一次）。

**失误（penalty）**
官方原文："If, after the two actions, the active player doesn't cross out at least one number, he must cross out one of the penalty boxes."

- **主动玩家**若两步动作**合计一格都没划**（无论是"不能划"还是"不想划"），**必须**划掉一个失误格。也就是说主动玩家可以策略性放弃划记、主动吃一个失误。
- **非主动玩家**不划**不算失误**、无任何惩罚。
- 每个失误格终局 **-5 分**。

**回合结束**：左手边（顺时针）下一位玩家成为新的主动玩家，重掷全部剩余骰子，重复上述流程。

### 1.4 锁定一行（Locking a row）

官方原文要点：

1. 想划某行**最右端数字**（红 12 / 黄 12 / 绿 2 / 蓝 2），必须**此前已在该行划了至少 5 个数字**（即最右端数字至少是该行第 6 个划记）。
2. 划掉最右端数字时，**同时把紧邻的锁定符号格也划掉**。**锁定格上的这个叉计入该行的划记总数**（官方 NOTES 明确："The cross on the lock counts toward the total number of crosses marked in that color-row"）——因此一行最多 11 数字 + 1 锁 = **12 个划记 = 78 分**，这就是计分表存在"12x"档的原因。
3. 该行随即对**所有玩家**封闭，之后任何人不得再在该颜色行划记；对应颜色的**彩骰立即（immediately）移出游戏**。
4. 锁行者须大声宣告（NSV 版明确要求）。

**同一动作内的同时锁定（重要细节，官方 NOTES 原文）**：
"If a row is locked during the first action, it is possible that other players may, at the same time, also cross out the number on the extreme right and lock the same color-row. These players must also have previously crossed out at least five numbers in that row."

即：若某人在**动作 1**中锁了一行，**同一动作中**其他玩家也可以同时划该最右端数字并划锁（因为动作 1 本来就是全员同时可用的）；但每个这样做的玩家都必须**自己**满足"该行已划 ≥5"的条件。已划 <5 的玩家即使看到别人锁行，也**不得**划最后一格（NSV 规则明确写出这条禁止）。封闭效果从**下一次划记机会起**生效——即"同一轮（同一个动作 1）其他玩家还能划最后一格并一起锁"，但之后（包括本回合的动作 2）不能再动该行。

> 实现要点：动作 1 应实现为"对所有玩家同时结算的一个决策窗口"，锁定判定在该窗口结算完毕后统一生效；不要按座位次序逐个结算（否则会错误地让后结算的玩家被先锁定者封锁）。

**锁定与动作 2 的交互**：彩骰"立即移出"意味着——若某行在动作 1 中被锁，主动玩家在动作 2 中**不能再选用该颜色骰**，也不能再在该行划记。

### 1.5 游戏结束条件

官方原文："The game ends immediately as soon as either someone has marked a cross in his fourth penalty box or as soon as two dice have been removed from the game (two color-rows have been locked)."

游戏在以下任一情况发生时**立即**结束：

1. **任意一名**玩家划下第 **4 个失误**格（该判定发生在其回合两步动作结束后记失误的瞬间）；
2. **累计两行被锁定**（不要求同一玩家锁的、也不要求锁在同一张表上——行锁是全局的），即两枚彩骰被移出。

细节：
- 官方明确指出：在动作 1 中可能出现**第 2 行与第 3 行同时被锁**（不同玩家同时锁不同行），这合法，游戏在该动作结算后结束。
- "立即结束"意味着：若第 2 行在动作 1 中被锁，**动作 2 不再执行**；若在动作 2 中被锁，回合即刻终止（也不再检查主动玩家失误——他已经划了记号，本就无失误）。
- 第 4 个失误照记，-20 分照算，然后立即结束。

### 1.6 计分

每行按**划记数量（含锁定格的叉）**查表得分，四行相加，再减去失误分（每个 -5）：

| 划记数 x | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 得分 | 1 | 3 | 6 | 10 | 15 | 21 | 28 | 36 | 45 | 55 | 66 | 78 |

即三角数公式 `score(x) = x(x+1)/2`。总分最高者获胜（官方规则未规定平局打破方式）。
理论单行上限 78，四行满贯 312。

来源：[Gamewright 官方规则 PDF](https://gamewright.com/pdfs/Rules/QwixxTM-RULES.pdf)、[NSV 官方英文规则 PDF](https://www.nsv.de/wp-content/uploads/2024/04/QwixxWuerfel_GB.pdf)、[NSV Qwixx 产品页](https://www.nsv.de/en/qwixx-our-classic/)、[UltraBoardGames 规则转录](https://www.ultraboardgames.com/qwixx/game-rules.php)。

---

## 2. 面向实现的精确化：状态机与合法动作

### 2.1 回合状态机

```
ROLL(active) → ACTION1_WINDOW(所有玩家同时决策) → resolve1
  → if 游戏结束条件满足 → GAME_OVER
  → ACTION2_DECISION(仅 active) → resolve2
  → if 游戏结束条件满足 → GAME_OVER
  → PENALTY_CHECK(仅 active：本回合 resolve1+resolve2 中 active 划记数==0 → 记失误)
  → if active 失误数==4 → GAME_OVER
  → NEXT_PLAYER → ROLL
```

### 2.2 合法动作枚举

设白骰 w1、w2，彩骰 {r,y,g,b}（已锁定颜色的骰子不存在）。

- **动作 1**（每个玩家独立）：`PASS`，或 `MARK(row, w1+w2)`，其中 row 为任一未锁定行、该行中数值 `w1+w2` 的格子位置 > rightmost(row)；若该格是最右端数字，还需 `count(row) ≥ 5`。
- **动作 2**（仅主动玩家）：`PASS`，或 `MARK(color_row, wi + d_color)`，wi ∈ {w1,w2}，d_color ∈ 尚在场的彩骰；同样的位置与锁定前置条件（以动作 1 结算后的行状态判断）。
- **失误不是可选动作**，而是"主动玩家两步皆 PASS/无合法划记"的强制结果；但由于两步动作本身可自由 PASS，等效于主动玩家拥有"自愿吃失误"的选择。

### 2.3 容易做错的边界情况

1. **动作 1 必须全员同时结算**（见 1.4），锁定生效不早于窗口结束。
2. 动作 2 的合法性基于**动作 1 之后**的行状态：动作 1 里主动玩家自己划的格子会约束动作 2（同行必须更靠右；动作 1 锁掉的行/移除的骰不可用）。
3. 白骰**只有"和"**这一种用法；主动玩家可以**跳过动作 1 只用动作 2**，但不能先彩后白（顺序固定，对状态机而言动作 1 窗口总是先发生）。
4. 第二行锁定的"立即结束"要在**每步动作结算后**各检查一次（动作 1 后结束则跳过动作 2 与失误检查）。
5. 非主动玩家在整个回合中只有动作 1 一个决策点，且 PASS 无代价。
6. 锁定格的叉**计入行内划记数**（影响计分档位）。

---

## 3. 官方变体记分卡：Qwixx gemixxt / Qwixx Mixx / Deluxe 附带变体

**命名澄清**：德文原版扩展叫 **Qwixx gemixxt**（NSV，2014，两本新记分本），英语/荷语市场译名 **Qwixx Mixx**（White Goblin Games 等），二者是**同一个产品**（[BGG 条目](https://boardgamegeek.com/boardgameexpansion/167305/qwixx-mixx)）。Gamewright 的 **Qwixx Deluxe**（干擦板豪华版，含 8 块干擦记分板与笔）**附带了 Mixx 变体面**作为替换玩法（[Gamewright 产品页](https://gamewright.com/product/qwixx-deluxe)、[BGG](https://boardgamegeek.com/boardgame/208775/qwixx-deluxe)）；NSV 2025 年也另出了自己的 Qwixx Deluxe（NSV 4157）。

官方总则（NSV 英文规则原文）："All the Qwixx dice game rules remain exactly the same." 两个变体只改记分卡布局，骰子、回合流程、失误、结束条件、计分表全部不变。

### 3.1 变体 A —— 颜色乱序（数字有序）

- 每行数字仍按原版升/降序（上两行 2→12，下两行 12→2），但**行内颜色被切成若干小段混排**：例如红 10 可能出现在最下面一行。
- 划记：动作 1 白骰和可划任一行中数值相符、位置合法的格子；动作 2 的"白+彩"只能划**对应颜色**的格子（无论它在哪一行）。
- **锁行**：划掉某行**最右端数字**（须为该行**至少第 6 个划记**，与基础版一致）即完成该行——**移出的是"最右端那格颜色"的骰子**，该**行**对所有人封闭。
- 官方特别注明：该颜色骰被移除后，**其他三行中该颜色的格子仍可通过两白骰之和划掉**（只是不能再用该彩骰组合）。
- 计分：**按行**计分，与原版相同。

### 3.2 变体 B —— 行内数字乱序（颜色有序）

- 四行颜色与原版相同（整行单色），但**行内数字不再有序**，随机混排。"从左到右"规则不变——合法性取决于**位置**而非数值大小。
- **锁行数字各行不同**：在 NSV 官方卡面上，红行最右端是 **11**、黄 **10**、绿 **3**、蓝 **4**（不同印刷批次卡面可能不同，实现时应以卡面数据为准）。锁行前置条件仍是该行已划 ≥5。
- 计分：与原版相同。

> 实现要点：把记分卡抽象为 `cell(row, index) = {color, number}` 的二维表即可同时覆盖基础版、变体 A、变体 B；合法性判断始终是 `index > rightmost(row)` + 颜色/数值匹配 + 锁行条件。

来源：[NSV "Qwixx mixed" 官方英文规则 PDF](https://www.nsv.de/wp-content/uploads/2024/04/QwixxGX_GB.pdf)、[NSV gemixxt 产品页](https://www.nsv.de/en/produkt/130014179-4012426880360-qwixx-gemixxt-additional-blocks/)、[qwixx.nl 变体介绍](https://qwixx.nl/varianten/qwixx-mixx-uitbreiding/)。

---

## 4. 其他官方版本与扩展

### 4.1 Qwixx Longo（独立游戏，NSV，2021）

来自[官方英文规则 PDF](https://www.nsv.de/wp-content/uploads/2024/04/QwixxLongo_GB.pdf)（2–5 人，约 20 分钟；含骰子与干擦板）：

- 四行加长为 **2–16 / 16–2**（每行 15 个数字；红黄升序、绿蓝降序）。使用 **6 枚八面骰**（点数 1–8，官方规则 PDF 配图确认），故白骰和最大 16。
- **锁行**：可用**最后两个数字之一**锁行（红/黄 15 或 16，绿/蓝 3 或 2），前置条件提高为**该行已划至少 6 个**。锁行后同样立刻划锁定符号（计分）、移除彩骰、全员封闭。
- **幸运数字（Lucky numbers）**：每张记分板印有 2 个不同的幸运数字。**动作 1** 中两白骰之和若等于你的幸运数字，你可以**改为**在你当前划记最少的颜色行中划掉"下一个可划的格子"（多行并列最少时任选其一）。整局可反复触发；用幸运数字锁行也是允许的（须满足全部锁行条件）。
- 其余规则（两步动作、失误 -5、4 失误或 2 行锁定即刻结束、按划记数查表计分）与原版一致；计分表延伸到更多档位（延续三角数，官方示例 8x=36、9x=45 与原公式一致；更高档位数值本次未从 PDF 版式中直接提取，建议按 x(x+1)/2 实现并以卡面核对）。

参考评测：[Casual Game Revolution](https://casualgamerevolution.com/blog/2022/05/qwixx-longo-extra-dice-lucky-numbers-and-longer-play)。

### 4.2 Qwixx Big Points（替换记分本扩展，NSV）

来自[官方英文规则 PDF](https://www.nsv.de/wp-content/uploads/2024/04/QwixxBP_GB.pdf)：

- 基础规则完全不变；记分卡在红/黄行之间和绿/蓝行之间各加一条**双色奖励行**（圆形格）。
- **划奖励格的条件**：你已划掉某个普通彩色格（如绿 10）后，若之后再"掷出同样的数"（该彩骰组合再出绿 10，或动作 1 白骰和为 10），可划掉其**相邻的双色奖励格**。若相邻两个普通格一个都没划过，则不得划该奖励格。
- 奖励行同样遵守**从左到右、跳过不补**。
- 奖励格**不单独计分**，但终局时**同时计入相邻两条颜色行**的划记数（因此单行最多可计 15 个划记，`15×16/2 = 120` 分封顶；超过 15 的部分不计）。
- 奖励格**不计入**锁行所需的"至少 5 个（即第 6 个）"门槛；某行锁定后其相邻奖励格**仍可继续划**并照常计分。
- 若主动玩家本回合**只划了奖励格**，**不算失误**。

### 4.3 Qwixx Bonus（替换记分本扩展，NSV，2020）

来自[官方英文规则 PDF](https://www.nsv.de/wp-content/uploads/2024/04/Qwixx_Bonus_GB.pdf)（[BGG](https://boardgamegeek.com/boardgame/320877/qwixx-bonus)）。两种版面：

- **版本 A（奖励条）**：四条颜色行里共有 12 个带黑框的"奖励格"。每当你划掉一个奖励格，**立即**在卡下方的奖励条中从左到右划掉下一个空格；该格印着一种颜色，你**必须立即**在那条颜色行里划掉"下一个可划的格子"。奖励可能触发**连锁**（新划的格子又是奖励格），连锁立即依次结算。某颜色行被（任何人）锁定后，所有玩家立刻把奖励条中该颜色的剩余格子划掉作废（跳过）。已完成的行绝不能再被划。奖励划记可以完成/锁定一行并因此触发游戏结束。
- **版本 B（成对奖励）**：四行中共 10 个奖励格，分 5 种符号、每种 2 个。集齐同种 2 个即获得对应奖励：① 立即在你当前划记最少的行里划 2 格（无法执行的部分作废）；② 立即在**每条**颜色行各划 1 格（按规则的下一个可划格）；③ 终局把你划记最少的那一行得分**翻倍**（并列时任选一行）；④ 终局 **+13 分**；⑤ 你的失误**不再计负分**——但注意官方明确：即便负分被免除，**第 4 个失误仍会照常结束游戏**。奖励划记同样可以锁行并触发终局。

### 4.4 Qwixx Connected（替换记分本扩展，NSV，2018）

来自[官方英文规则 PDF](https://www.nsv.de/wp-content/uploads/2024/04/Qwixx_connect_GB.pdf)（[BGG](https://boardgamegeek.com/boardgame/270715/qwixx-connected)）。两种版面，每种有 A–E 五款不同布局，玩家各拿不同款：

- **版本 A（台阶 The Steps）**：一条 11 格的黑框"台阶"路径斜穿四条颜色行。玩法完全不变；终局除四行正常计分外，**被划到的台阶格**按同一张三角数表额外计分（11 格满 66 分）。台阶格"一格两算"（既算行分又算台阶分）。
- **版本 B（锁链 The Chain）**：卡上若干**成对圆圈格由连线相连**。划掉一对中的任意一格，**必须自动立即划掉与之相连的另一格**；这次自动划记**不受**从左到右等常规限制，甚至**该行已完成/锁定也照划**（官方例子明确）。四行计分方式不变。

> 实现要点（版本 B）："自动连锁划记豁免一切常规合法性检查"是对状态机的特殊旁路，且官方未明说被自动划的格子是否影响该行后续"从左到右"的基准；保守实现可把它同样纳入 rightmost 计算（此点官方文本未显式裁定，**存在解释空间**）。

### 4.5 Qwixx Double（替换记分本扩展，NSV，2022）

来自[官方英文规则 PDF](https://www.nsv.de/wp-content/uploads/2024/04/Qwixx_Double_GB.pdf)。两种版面都把锁行门槛从 5 提高到 **7 个叉**，单行最多按 16 个叉计 **136 分**：

- **A**：每行最近划下的数字以后再次掷出时，可以在该格下方再划第二个叉；主动或非主动玩家均可。每个数字最多两个叉，第二叉不改变“最右位置”。
- **B**：每行印有 4 个双倍格；命中时立即在同一格画两个叉。官方卡面位置为升序行 3/5/9/11、降序行 10/8/6/4。
- 官方允许同局玩家分别选 A 或 B；两版按设计强度接近。

### 4.6 Qwixx On Board（独立游戏，NSV，2019）

[官方英文规则 PDF](https://www.nsv.de/wp-content/uploads/2025/06/QwixxOnBoard_GB.pdf)：2–4 人，约 20 分钟。原版两步动作外，主动玩家增加动作 3，向前移动 1–5 个空位；落点数字必须已在自己的表上划过，或在这次移动时按原规则划下。棋子位置终局提供 1–20 额外分。首名棋子进入最后 5 格后，其余玩家各再当一次主动玩家；原版的两行锁定/四次失误仍会立即结束游戏。由于它需要公共双面图板与棋子，不作为本项目的替换记分卡预设。

### 4.7 Qwixx X-Change（替换记分本扩展，NSV，2024）

来自[官方英文规则 PDF](https://www.nsv.de/wp-content/uploads/2024/09/QwixxXChange_EN.pdf)：卡下方新增 9 个有序交换格
`8↔5, 9↔7, 11↔3, 7↔4, 10↔3, 8↔6, 10↔5, 11↔9, 6↔4`。动作 1 中主动玩家宣布白骰和后，每名玩家可为自己使用一个匹配的交换格，把和值换成另一端再按原规则划记。交换格从左到右使用，可跳过但不能回头；不会改变实体骰面，也不影响其他玩家。

### 4.8 其他相关官方产品（简述）

- **Qwixx: Das Kartenspiel（Qwixx 卡牌版）**：用牌库代替骰子，规则结构类似（[Gamewright 卡牌版规则 PDF](https://boardgame.bg/qwixx%20the%20card%20game%20rules.pdf)）；gemixxt 记分本可与卡牌版混用。
- **Qwixx Das Duell / Qwixx Paarspiel** 等衍生亦存在，核心机制改动较大，未在本次调研范围内详查（未证实细节）。

---

## 5. 常见争议点 / FAQ（附裁定与依据）

| # | 问题 | 裁定 | 依据 |
|---|---|---|---|
| 1 | 两个白骰可以分开各当一个数用吗？ | **不可以**。动作 1 只定义了"两白骰之和"这一种用法。 | 官方规则动作 1 原文 |
| 2 | 主动玩家可以跳过白骰和、只用"白+彩"组合吗？ | **可以**。两步动作对主动玩家都是"may (but is not required to)"；只要两步合计至少划 1 格就不吃失误。 | 官方规则动作 1/2 及 penalty 条款原文 |
| 3 | 白骰和与彩骰组合有先后顺序吗？ | **有，必须先动作 1 后动作 2**："carried out in order, always one after the other"。 | Gamewright PDF "HOW TO PLAY" |
| 4 | 主动玩家一回合能划两格吗？能在同一行吗？ | **能**（动作 1 + 动作 2 各一格）；**同一行也可以**，第二格必须位于第一格右侧（可紧邻）。不能把同一个格子划两次。 | 由两步动作 + 左到右规则直接推出 |
| 5 | 某人锁行的那"一轮"，其他人还能划最后一格吗？ | **同一个动作 1 内可以**：其他玩家可同时划最右格并一起锁行，但各自必须已在该行划 ≥5；已划 <5 者不得划最后一格。动作 1 结算完毕后该行即对所有人封闭（包括本回合的动作 2）。 | 官方 NOTES 原文（见 1.4）；[BGG 讨论](https://boardgamegeek.com/thread/1240674/locking-rows-and-game-ending) |
| 6 | 锁定格的叉计不计入行划记数？ | **计入**（满行 = 11 数字 + 1 锁 = 12 划记 = 78 分）。 | 官方 NOTES 原文 |
| 7 | 失误可以主动选择吗？ | 主动玩家**可以**通过两步都不划来"自愿"吃失误；**非主动玩家不划永远不吃失误**。 | penalty 条款原文 |
| 8 | 锁行后彩骰何时移除？ | **立即**。若锁发生在动作 1，主动玩家动作 2 不能再用该彩骰、不能再划该行。 | "The die ... is immediately removed from the game" |
| 9 | 第二行在动作 1 被锁，动作 2 还执行吗？ | 规则写明游戏"**立即**结束"——通行解读为动作 2 不再执行；主流电子实现亦如此处理。 | 官方 ENDING THE GAME 原文 |
| 10 | 一次动作能同时锁两行吗？ | 能：动作 1 中不同玩家可同时锁不同的行（甚至第 2、第 3 行同时锁），游戏随即结束。 | 官方 ENDING THE GAME 的 Note 与示例 |
| 11 | 锁行是全局的还是各人各自的？ | **全局**：任何人锁了某色行，所有人的该行都封闭、该彩骰移出。两行锁定的终局条件按全局累计。 | 官方规则原文 |
| 12 | 平局怎么办？ | 官方规则未规定平局打破，电子实现可自行定义（本项目：并列共同获胜）。 | 官方规则（缺省） |

---

## 6. 来源汇总

**官方规则 PDF（一手来源）**
- 基础版（Gamewright，英/西双语）：https://gamewright.com/pdfs/Rules/QwixxTM-RULES.pdf
- 基础版（NSV 英文）：https://www.nsv.de/wp-content/uploads/2024/04/QwixxWuerfel_GB.pdf
- Qwixx gemixxt / "Qwixx mixed"（变体 A/B）：https://www.nsv.de/wp-content/uploads/2024/04/QwixxGX_GB.pdf
- Qwixx Longo：https://www.nsv.de/wp-content/uploads/2024/04/QwixxLongo_GB.pdf
- Qwixx Big Points：https://www.nsv.de/wp-content/uploads/2024/04/QwixxBP_GB.pdf
- Qwixx Bonus（版本 A/B）：https://www.nsv.de/wp-content/uploads/2024/04/Qwixx_Bonus_GB.pdf
- Qwixx Connected（版本 A/B）：https://www.nsv.de/wp-content/uploads/2024/04/Qwixx_connect_GB.pdf
- Qwixx Double（版本 A/B）：https://www.nsv.de/wp-content/uploads/2024/04/Qwixx_Double_GB.pdf
- Qwixx X-Change：https://www.nsv.de/wp-content/uploads/2024/09/QwixxXChange_EN.pdf
- Qwixx On Board：https://www.nsv.de/wp-content/uploads/2025/06/QwixxOnBoard_GB.pdf
- NSV 规则下载总页：https://www.nsv.de/en/game-rules/

**出版社/产品页**
- Gamewright Qwixx Deluxe：https://gamewright.com/product/qwixx-deluxe
- NSV gemixxt 产品页：https://www.nsv.de/en/produkt/130014179-4012426880360-qwixx-gemixxt-additional-blocks/

**BGG 与第三方**
- BGG Qwixx：https://boardgamegeek.com/boardgame/131260/qwixx
- Qwixx Mixx：https://boardgamegeek.com/boardgameexpansion/167305/qwixx-mixx
- Qwixx Deluxe：https://boardgamegeek.com/boardgame/208775/qwixx-deluxe
- 锁行/终局讨论帖：https://boardgamegeek.com/thread/1240674/locking-rows-and-game-ending
- UltraBoardGames 规则转录：https://www.ultraboardgames.com/qwixx/game-rules.php

**可靠性说明**：第 1、3 节及 4.1–4.7 均核对自官方规则 PDF；记分卡中仅靠图形表达的格位另以官方规则插图/产品卡面交叉核验。FAQ 第 9 条是对官方"immediately"措辞的通行解读。
