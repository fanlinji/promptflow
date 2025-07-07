# Prompt Flow Action

使用LLM API处理GitHub issues和discussions的GitHub Action。

## 概述

这个GitHub Action项目提供了两个主要工作流：

1. **Prompt + Comment工作流**：将特定issue中的评论作为提示，调用LLM API，并将生成的内容发布到discussions中。

2. **Prompt + Reply工作流**：将discussions中的评论作为输入，与issue中的提示模板结合，并将LLM生成的回复发布回原始discussion评论。

两个工作流共享API调用的通用功能，具有多模型和API密钥的复杂容错机制。

## 设置

### 1. API配置

在你的仓库中创建一个带有`api`标签的issue。这个issue中的每个评论应包含以下格式的模型配置：

```
name: 模型名称
url: https://api-endpoint.com/v1/chat/completions
key1: 你的api密钥-1
key2: 你的api密钥-2
```

评论的顺序决定了模型的优先级。如果一个模型失败，系统将尝试下一个。

### 2. Prompt + Comment工作流

1. 创建一个同时带有`prompt`和`comment`标签的issue（例如，"生成诗歌"）。
2. 在此issue中添加以下格式的评论：
   ```
   PoetryPrompt: 写一首关于自然的诗。
   ```
3. 工作流将处理每条评论，调用LLM API，并将结果发布到具有相同标题的discussion中。
4. 已处理的评论将被标记为👎反应。

### 3. Prompt + Reply工作流

1. 创建一个同时带有`prompt`和`reply`标签的issue（例如，"诗歌评论"）。
2. 在此issue中添加以下格式的模板评论：
   ```
   SummaryPrompt: 总结以下诗歌：{{文章}}
   ```
3. 工作流将查找discussions中的评论，用评论内容替换`{{文章}}`，并发布生成的回复。
4. 已处理的评论和模板将被标记为👎反应。

## 使用方法

### GitHub Action工作流

此action可以在GitHub工作流中使用：

```yaml
name: 处理提示

on:
  schedule:
    - cron: '0 */6 * * *'  # 每6小时运行一次
  workflow_dispatch:  # 允许手动触发

jobs:
  process-prompts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: 运行Prompt Action
        uses: your-username/prompt-flow-action@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          data-repo: ${{ github.repository }}
          workflow-type: 'prompt-comment'  # 或 'prompt-reply'
```

## 输入参数

| 输入 | 描述 | 必需 | 默认值 |
|-------|-------------|----------|---------|
| `github-token` | 具有repo权限的GitHub令牌 | 是 | `${{ github.token }}` |
| `data-repo` | 存放issues和discussions的仓库 | 是 | - |
| `workflow-type` | 要运行的工作流类型（`prompt-comment`或`prompt-reply`） | 是 | - |

## 状态标记

此action使用👎反应来标记已处理的项目：

- 在issues中：带有👎的评论被视为已处理，将被跳过。
- 在discussions中：带有👎的评论被视为已处理，将被跳过。

## 许可证

MIT 