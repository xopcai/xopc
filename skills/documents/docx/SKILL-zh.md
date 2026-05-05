---
name: docx
description: "当用户想要创建、读取、编辑或操作 Word 文档（.docx 文件）时使用本技能。触发条件包括：任何提到'Word 文档'、'word document'、'.docx' 或要求生成带有目录、标题、页码或信头等格式的专业文档时。也适用于从 .docx 文件中提取或重组内容、在文档中插入或替换图片、在 Word 文件中执行查找替换、处理修订或批注，或将内容转换为精美的 Word 文档。如果用户要求以 Word 或 .docx 文件形式提供'报告'、'备忘录'、'信函'、'模板'或类似交付物，使用本技能。不要用于 PDF、电子表格、Google Docs 或与文档生成无关的常规编码任务。"
license: 专有。完整条款见 LICENSE.txt
---

# DOCX 创建、编辑和分析

## 概述

.docx 文件是包含 XML 文件的 ZIP 归档。

## 快速参考

| 任务 | 方法 |
|------|------|
| 读取/分析内容 | `pandoc` 或解包以获取原始 XML |
| 创建新文档 | 使用 `docx-js`——见下方"创建新文档" |
| 编辑现有文档 | 解包 → 编辑 XML → 重新打包——见下方"编辑现有文档" |

### 转换 .doc 为 .docx

旧版 `.doc` 文件必须先转换才能编辑：

```bash
python scripts/office/soffice.py --headless --convert-to docx document.doc
```

### 读取内容

```bash
# 带修订标记的文字提取
pandoc --track-changes=all document.docx -o output.md

# 原始 XML 访问
python scripts/office/unpack.py document.docx unpacked/
```

### 转换为图片

```bash
python scripts/office/soffice.py --headless --convert-to pdf document.docx
pdftoppm -jpeg -r 150 document.pdf page
```

### 接受修订

要生成一个接受所有修订的干净文档（需要 LibreOffice）：

```bash
python scripts/accept_changes.py input.docx output.docx
```

---

## 创建新文档

使用 JavaScript 生成 .docx 文件，然后验证。安装：`npm install -g docx`

### 设置
```javascript
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
        Header, Footer, AlignmentType, PageOrientation, LevelFormat, ExternalHyperlink,
        InternalHyperlink, Bookmark, FootnoteReferenceRun, PositionalTab,
        PositionalTabAlignment, PositionalTabRelativeTo, PositionalTabLeader,
        TabStopType, TabStopPosition, Column, SectionType,
        TableOfContents, HeadingLevel, BorderStyle, WidthType, ShadingType,
        VerticalAlign, PageNumber, PageBreak } = require('docx');

const doc = new Document({ sections： [{ children： [/* 内容 */] }] });
Packer.toBuffer(doc).then(buffer => fs.writeFileSync("doc.docx", buffer));
```

### 验证
创建文件后，进行验证。如果验证失败，解包、修复 XML 并重新打包。
```bash
python scripts/office/validate.py doc.docx
```

### 页面大小

```javascript
// 关键：docx-js 默认为 A4，不是美式信纸
// 始终显式设置页面大小以保证结果一致
sections： [{
  properties： {
    page： {
      size： {
        width： 12240,   // 8.5 英寸，单位为 DXA
        height： 15840   // 11 英寸，单位为 DXA
      },
      margin： { top： 1440, right： 1440, bottom： 1440, left： 1440 } // 1 英寸边距
    }
  },
  children： [/* 内容 */]
}]
```

**常见页面大小（DXA 单位，1440 DXA = 1 英寸）：**

| 纸张 | 宽 | 高 | 内容宽度（1 英寸边距） |
|------|------|--------|---------------------|
| 美式信纸 | 12,240 | 15,840 | 9,360 |
| A4（默认） | 11,906 | 16,838 | 9,026 |

**横向：** docx-js 内部会交换宽/高，所以传入纵向尺寸，让它处理交换：
```javascript
size： {
  width： 12240,   // 传入 SHORT 边作为 width
  height： 15840,  // 传入 LONG 边作为 height
  orientation： PageOrientation.LANDSCAPE  // docx-js 在 XML 中交换
},
// 内容宽度 = 15840 - 左边距 - 右边距（使用长边）
```

### 样式（覆盖内置标题）

使用 Arial 作为默认字体（通用支持）。保持标题为黑色以确保可读性。

```javascript
const doc = new Document({
  styles： {
    default： { document： { run： { font： "Arial", size： 24 } } }, // 12pt 默认
    paragraphStyles： [
      // 重要：使用精确 ID 覆盖内置样式
      { id： "Heading1", name： "Heading 1", basedOn： "Normal", next： "Normal", quickFormat： true,
        run： { size： 32, bold： true, font： "Arial" },
        paragraph： { spacing： { before： 240, after： 240 }, outlineLevel： 0 } }, // TOC 需要 outlineLevel
      { id： "Heading2", name： "Heading 2", basedOn： "Normal", next： "Normal", quickFormat： true,
        run： { size： 28, bold： true, font： "Arial" },
        paragraph： { spacing： { before： 180, after： 180 }, outlineLevel： 1 } },
    ]
  },
  sections： [{
    children： [
      new Paragraph({ heading： HeadingLevel.HEADING_1, children： [new TextRun("标题")] }),
    ]
  }]
});
```

### 列表（永远不要使用 Unicode 项目符号）

```javascript
// ❌ 错误——不要手动插入项目符号字符
new Paragraph({ children： [new TextRun("• 项目")] })  // 错误
new Paragraph({ children： [new TextRun("\u2022 项目")] })  // 错误

// ✅ 正确——使用 LevelFormat.BULLET 的编号配置
const doc = new Document({
  numbering： {
    config： [
      { reference： "bullets",
        levels： [{ level： 0, format： LevelFormat.BULLET, text： "•", alignment： AlignmentType.LEFT,
          style： { paragraph： { indent： { left： 720, hanging： 360 } } } }] },
      { reference： "numbers",
        levels： [{ level： 0, format： LevelFormat.DECIMAL, text： "%1.", alignment： AlignmentType.LEFT,
          style： { paragraph： { indent： { left： 720, hanging： 360 } } } }] },
    ]
  },
  sections： [{
    children： [
      new Paragraph({ numbering： { reference： "bullets", level： 0 },
        children： [new TextRun("项目符号项")] }),
      new Paragraph({ numbering： { reference： "numbers", level： 0 },
        children： [new TextRun("编号项")] }),
    ]
  }]
});

// ⚠️ 每个 reference 创建独立的编号
// 同一 reference = 继续（1，2，3 然后 4，5，6）
// 不同 reference = 重新开始（1，2，3 然后 1，2，3）
```

### 表格

**关键：表格需要双重宽度**——同时设置表格的 `columnWidths` 和每个单元格的 `width`。缺少任何一个，表格在某些平台上会渲染不正确。

```javascript
// 关键：始终设置表格宽度以保证一致的渲染
// 关键：使用 ShadingType.CLEAR（非 SOLID）以防止黑色背景
const border = { style： BorderStyle.SINGLE, size： 1, color： "CCCCCC" };
const borders = { top： border, bottom： border, left： border, right： border };

new Table({
  width： { size： 9360, type： WidthType.DXA }, // 始终使用 DXA（百分比在 Google Docs 中出错）
  columnWidths： [4680, 4680], // 必须总和等于表格宽度（DXA：1440 = 1 英寸）
  rows： [
    new TableRow({
      children： [
        new TableCell({
          borders,
          width： { size： 4680, type： WidthType.DXA }, // 也要在每个单元格上设置
          shading： { fill： "D5E8F0", type： ShadingType.CLEAR }, // CLEAR 而非 SOLID
          margins： { top： 80, bottom： 80, left： 120, right： 120 }, // 单元格内边距（内部的，不增加宽度）
          children： [new Paragraph({ children： [new TextRun("单元格")] })]
        })
      ]
    })
  ]
})
```

**表格宽度计算：**

始终使用 `WidthType.DXA`——`WidthType.PERCENTAGE` 在 Google Docs 中会出错。

```javascript
// 表格宽度 = columnWidths 之和 = 内容宽度
// 美式信纸 1 英寸边距：12240 - 2880 = 9360 DXA
width： { size： 9360, type： WidthType.DXA },
columnWidths： [7000, 2360]  // 必须总和等于表格宽度
```

**宽度规则：**
- **始终使用 `WidthType.DXA`**——永远不要用 `WidthType.PERCENTAGE`（与 Google Docs 不兼容）
- 表格宽度必须等于 `columnWidths` 之和
- 单元格 `width` 必须匹配对应的 `columnWidth`
- 单元格 `margins` 是内部边距——减少内容区域，不增加单元格宽度
- 对于全宽表格：使用内容宽度（页面宽度减去左右边距）

### 图片

```javascript
// 关键：type 参数是必需的
new Paragraph({
  children： [new ImageRun({
    type： "png", // 必需：png、jpg、jpeg、gif、bmp、svg
    data： fs.readFileSync("image.png"),
    transformation： { width： 200, height： 150 },
    altText： { title： "标题", description： "描述", name： "名称" } // 三者均必需
  })]
})
```

### 分页符

```javascript
// 关键：PageBreak 必须放在 Paragraph 内部
new Paragraph({ children： [new PageBreak()] })

// 或使用 pageBreakBefore
new Paragraph({ pageBreakBefore： true, children： [new TextRun("新页面")] })
```

### 超链接

```javascript
// 外部链接
new Paragraph({
  children： [new ExternalHyperlink({
    children： [new TextRun({ text： "点击此处", style： "Hyperlink" })],
    link： "https://example.com",
  })]
})

// 内部链接（书签 + 引用）
// 1. 在目标位置创建书签
new Paragraph({ heading： HeadingLevel.HEADING_1, children： [
  new Bookmark({ id： "chapter1", children： [new TextRun("第 1 章")] }),
]})
// 2. 链接到它
new Paragraph({ children： [new InternalHyperlink({
  children： [new TextRun({ text： "查看第 1 章", style： "Hyperlink" })],
  anchor： "chapter1",
})]})
```

### 脚注

```javascript
const doc = new Document({
  footnotes： {
    1： { children： [new Paragraph("来源：2024 年度报告")] },
    2： { children： [new Paragraph("方法说明见附录")] },
  },
  sections： [{
    children： [new Paragraph({
      children： [
        new TextRun("收入增长 15%"),
        new FootnoteReferenceRun(1),
        new TextRun("，按调整后指标"),
        new FootnoteReferenceRun(2),
      ],
    })]
  }]
});
```

### 制表位

```javascript
// 同一行右对齐文字（如日期与标题相对）
new Paragraph({
  children： [
    new TextRun("公司名称"),
    new TextRun("\t2025 年 1 月"),
  ],
  tabStops： [{ type： TabStopType.RIGHT, position： TabStopPosition.MAX }],
})

// 点状前导符（如目录样式）
new Paragraph({
  children： [
    new TextRun("引言"),
    new TextRun({ children： [
      new PositionalTab({
        alignment： PositionalTabAlignment.RIGHT,
        relativeTo： PositionalTabRelativeTo.MARGIN,
        leader： PositionalTabLeader.DOT,
      }),
      "3",
    ]}),
  ],
})
```

### 多列布局

```javascript
// 等宽列
sections： [{
  properties： {
    column： {
      count： 2,          // 列数
      space： 720,        // 列间距（DXA，720 = 0.5 英寸）
      equalWidth： true,
      separate： true,    // 列之间垂直分隔线
    },
  },
  children： [/* 内容自然跨列流动 */]
}]

// 自定义宽度列（equalWidth 必须为 false）
sections： [{
  properties： {
    column： {
      equalWidth： false,
      children： [
        new Column({ width： 5400, space： 720 }),
        new Column({ width： 3240 }),
      ],
    },
  },
  children： [/* 内容 */]
}]
```

使用 `type： SectionType.NEXT_COLUMN` 的新章节强制分列。

### 目录

```javascript
// 关键：标题必须只使用 HeadingLevel——不使用自定义样式
new TableOfContents("目录", { hyperlink： true, headingStyleRange： "1-3" })
```

### 页眉/页脚

```javascript
sections： [{
  properties： {
    page： { margin： { top： 1440, right： 1440, bottom： 1440, left： 1440 } } // 1440 = 1 英寸
  },
  headers： {
    default： new Header({ children： [new Paragraph({ children： [new TextRun("页眉")] })] })
  },
  footers： {
    default： new Footer({ children： [new Paragraph({
      children： [new TextRun("第 "), new TextRun({ children： [PageNumber.CURRENT] }), new TextRun(" 页")]
    })] })
  },
  children： [/* 内容 */]
}]
```

### docx-js 的关键规则

- **显式设置页面大小**——docx-js 默认为 A4；美式文档使用美式信纸（12240 x 15840 DXA）
- **横向：传入纵向尺寸**——docx-js 内部交换宽/高；传入短边为 `width`，长边为 `height`，设置 `orientation： PageOrientation.LANDSCAPE`
- **永远不要使用 `\n`**——使用独立的 Paragraph 元素
- **永远不要使用 Unicode 项目符号**——使用带有 numbering config 的 `LevelFormat.BULLET`
- **PageBreak 必须在 Paragraph 中**——独立使用会生成无效 XML
- **ImageRun 需要 `type`**——始终指定 png/jpg 等
- **始终使用 DXA 设置表格 `width`**——永远不要使用 `WidthType.PERCENTAGE`（在 Google Docs 中出错）
- **表格需要双重宽度**——`columnWidths` 数组和单元格 `width`，两者必须匹配
- **表格宽度 = columnWidths 之和**——对于 DXA，确保它们精确相加
- **始终添加单元格边距**——使用 `margins： { top： 80, bottom： 80, left： 120, right： 120 }` 以保证可读的内边距
- **使用 `ShadingType.CLEAR`**——表格底纹永远不要用 SOLID
- **永远不要将表格用作分隔线/装饰线**——单元格有最小高度，会渲染为空盒子（包括在页眉/页脚中）；改用 Paragraph 上的 `border： { bottom： { style： BorderStyle.SINGLE, size： 6, color： "2E75B6", space： 1 } }`。对于两栏页脚，使用制表位（见制表位章节），不要使用表格
- **TOC 只接受 HeadingLevel**——标题段落上不要使用自定义样式
- **覆盖内置样式**——使用精确 ID："Heading1"、"Heading2" 等
- **包含 `outlineLevel`**——TOC 需要（H1 为 0，H2 为 1 等）

---

## 编辑现有文档

**按顺序执行所有 3 个步骤。**

### 第 1 步：解包
```bash
python scripts/office/unpack.py document.docx unpacked/
```
解包 XML，美化格式，合并相邻 runs，将智能引号转换为 XML 实体（`&#x201C；` 等）以便在编辑中存活。使用 `--merge-runs false` 跳过 run 合并。

### 第 2 步：编辑 XML

编辑 `unpacked/word/` 中的文件。XML 模式见下方 XML 参考。

**使用"Claude"作为修订和批注的作者**，除非用户明确要求使用其他名字。

**直接使用 Edit 工具进行字符串替换。不要编写 Python 脚本。** 脚本引入不必要的复杂性。Edit 工具精确展示替换的内容。

**关键：新内容使用智能引号。** 在添加包含撇号或引号的文字时，使用 XML 实体生成智能引号：
```xml
<!-- 使用这些实体获得专业排版效果 -->
<w：t>这里&#x2019；是一个引号：&#x201C；你好&#x201D；</w：t>
```
| 实体 | 字符 |
|------|--------|
| `&#x2018；` | '（左单引号） |
| `&#x2019；` | '（右单引号/撇号） |
| `&#x201C；` | "（左双引号） |
| `&#x201D；` | "（右双引号） |

**添加批注：** 使用 `comment.py` 处理跨多个 XML 文件的样板代码（文本必须预先转义为 XML）：
```bash
python scripts/comment.py unpacked/ 0 "批注文本包含 &amp； 和 &#x2019；"
python scripts/comment.py unpacked/ 1 "回复文本" --parent 0  # 回复批注 0
python scripts/comment.py unpacked/ 0 "文本" --author "自定义作者"  # 自定义作者名称
```
然后在 document.xml 中添加标记（见 XML 参考中的"批注"部分）。

### 第 3 步：打包
```bash
python scripts/office/pack.py unpacked/ output.docx --original document.docx
```
自动修复验证、压缩 XML 并创建 DOCX。使用 `--validate false` 跳过验证。

**自动修复会修复：**
- `durableId` >= 0x7FFFFFFF（重新生成有效 ID）
- 带空白的 `<w：t>` 缺少 `xml：space="preserve"`

**自动修复不会修复：**
- 格式错误的 XML、无效的元素嵌套、缺少关系、违反模式

### 常见陷阱

- **替换整个 `<w：r>` 元素**：添加修订时，替换整个 `<w：r>...</w：r>` 块，用 `<w：del>...<w：ins>...` 作为兄弟元素。不要将修订标签插入到 run 内部。
- **保留 `<w：rPr>` 格式**：将原 run 的 `<w：rPr>` 块复制到你的修订 run 中以保持粗体、字号等。

---

## XML 参考

### 模式合规

- **`<w：pPr>` 中的元素顺序**：`<w：pStyle>`、`<w：numPr>`、`<w：spacing>`、`<w：ind>`、`<w：jc>`、`<w：rPr>` 最后
- **空白字符**：对有前导/尾随空格的 `<w：t>` 添加 `xml：space="preserve"`
- **RSID**：必须为 8 位十六进制（如 `00AB1234`）

### 修订标记

**插入：**
```xml
<w：ins w：id="1" w：author="Claude" w：date="2025-01-01T00：00：00Z">
  <w：r><w：t>插入的文字</w：t></w：r>
</w：ins>
```

**删除：**
```xml
<w：del w：id="2" w：author="Claude" w：date="2025-01-01T00：00：00Z">
  <w：r><w：delText>已删除的文字</w：delText></w：r>
</w：del>
```

**在 `<w：del>` 内部**：使用 `<w：delText>` 代替 `<w：t>`，使用 `<w：delInstrText>` 代替 `<w：instrText>`。

**最小化编辑**——只标记变更：
```xml
<!-- 将"30 天"改为"60 天" -->
<w：r><w：t>期限为 </w：t></w：r>
<w：del w：id="1" w：author="Claude" w：date="...">
  <w：r><w：delText>30</w：delText></w：r>
</w：del>
<w：ins w：id="2" w：author="Claude" w：date="...">
  <w：r><w：t>60</w：t></w：r>
</w：ins>
<w：r><w：t> 天。</w：t></w：r>
```

**删除整个段落/列表项目**——删除段落的所有内容时，同时将段落标记标记为已删除，使其与下一段合并。在 `<w：pPr><w：rPr>` 中添加 `<w：del/>`：
```xml
<w：p>
  <w：pPr>
    <w：numPr>...</w：numPr>  <!-- 如有列表编号 -->
    <w：rPr>
      <w：del w：id="1" w：author="Claude" w：date="2025-01-01T00：00：00Z"/>
    </w：rPr>
  </w：pPr>
  <w：del w：id="2" w：author="Claude" w：date="2025-01-01T00：00：00Z">
    <w：r><w：delText>被删除的整个段落内容...</w：delText></w：r>
  </w：del>
</w：p>
```
没有 `<w：pPr><w：rPr>` 中的 `<w：del/>`，接受修订会留下空段落/列表项。

**拒绝另一位作者的插入**——将删除嵌套在其插入内部：
```xml
<w：ins w：author="张三" w：id="5">
  <w：del w：author="Claude" w：id="10">
    <w：r><w：delText>他们插入的文字</w：delText></w：r>
  </w：del>
</w：ins>
```

**恢复另一位作者的删除**——在其删除后添加插入（不要修改他们的删除）：
```xml
<w：del w：author="张三" w：id="5">
  <w：r><w：delText>已删除的文字</w：delText></w：r>
</w：del>
<w：ins w：author="Claude" w：id="10">
  <w：r><w：t>已删除的文字</w：t></w：r>
</w：ins>
```

### 批注

运行 `comment.py` 后（见第 2 步），在 document.xml 中添加标记。对于回复，使用 `--parent` 标志并将标记嵌套在父级内部。

**关键：`<w：commentRangeStart>` 和 `<w：commentRangeEnd>` 是 `<w：r>` 的兄弟元素，绝不在 `<w：r>` 内部。**

```xml
<!-- 批注标记是 w：p 的直接子元素，绝不在 w：r 内部 -->
<w：commentRangeStart w：id="0"/>
<w：del w：id="1" w：author="Claude" w：date="2025-01-01T00：00：00Z">
  <w：r><w：delText>已删除</w：delText></w：r>
</w：del>
<w：r><w：t>更多文字</w：t></w：r>
<w：commentRangeEnd w：id="0"/>
<w：r><w：rPr><w：rStyle w：val="CommentReference"/></w：rPr><w：commentReference w：id="0"/></w：r>

<!-- 批注 0 带嵌套在内的回复 1 -->
<w：commentRangeStart w：id="0"/>
  <w：commentRangeStart w：id="1"/>
  <w：r><w：t>文字</w：t></w：r>
  <w：commentRangeEnd w：id="1"/>
<w：commentRangeEnd w：id="0"/>
<w：r><w：rPr><w：rStyle w：val="CommentReference"/></w：rPr><w：commentReference w：id="0"/></w：r>
<w：r><w：rPr><w：rStyle w：val="CommentReference"/></w：rPr><w：commentReference w：id="1"/></w：r>
```

### 图片

1. 将图片文件添加到 `word/media/`
2. 在 `word/_rels/document.xml.rels` 中添加关系：
```xml
<Relationship Id="rId5" Type=".../image" Target="media/image1.png"/>
```
3. 在 `[Content_Types].xml` 中添加内容类型：
```xml
<Default Extension="png" ContentType="image/png"/>
```
4. 在 document.xml 中引用：
```xml
<w：drawing>
  <wp：inline>
    <wp：extent cx="914400" cy="914400"/>  <!-- EMU：914400 = 1 英寸 -->
    <a：graphic>
      <a：graphicData uri=".../picture">
        <pic：pic>
          <pic：blipFill><a：blip r：embed="rId5"/></pic：blipFill>
        </pic：pic>
      </a：graphicData>
    </a：graphic>
  </wp：inline>
</w：drawing>
```

---

## 依赖项

- **pandoc**：文字提取
- **docx**：`npm install -g docx`（新文档）
- **LibreOffice**：PDF 转换（通过 `scripts/office/soffice.py` 为沙箱环境自动配置）
- **Poppler**：`pdftoppm` 用于图片
