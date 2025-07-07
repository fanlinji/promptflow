import * as github from '@actions/github';
import * as core from '@actions/core';

/**
 * GitHub客户端类，用于与GitHub API交互
 */
export class GitHubClient {
  constructor(token, repo) {
    core.info(`初始化GitHub客户端，仓库: ${repo}`);
    
    if (!token) {
      core.error('GitHub令牌为空');
      throw new Error('GitHub令牌不能为空');
    }
    
    if (!repo || !repo.includes('/')) {
      core.error(`仓库格式无效: ${repo}`);
      throw new Error(`仓库格式无效，应为 'owner/repo': ${repo}`);
    }
    
    [this.owner, this.repo] = repo.split('/');
    core.info(`仓库所有者: ${this.owner}, 仓库名称: ${this.repo}`);
    
    try {
      this.octokit = github.getOctokit(token);
      core.info('GitHub客户端初始化成功');
    } catch (error) {
      core.error(`GitHub客户端初始化失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 通过编号获取issue
   * @param {number} issueNumber - Issue编号
   * @returns {Promise<Object>} - Issue对象
   */
  async getIssue(issueNumber) {
    const { data: issue } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber
    });
    return issue;
  }

  /**
   * 获取仓库中的所有issue
   * @param {Object} options - 过滤issue的选项
   * @returns {Promise<Array>} - Issue对象数组
   */
  async getIssues(options = {}) {
    core.info(`正在获取仓库 ${this.owner}/${this.repo} 的issues，选项: ${JSON.stringify(options)}`);
    try {
      core.info(`API调用参数: owner=${this.owner}, repo=${this.repo}, state=${options.state || 'open'}, per_page=100`);
      
      const { data: issues } = await this.octokit.rest.issues.listForRepo({
        owner: this.owner,
        repo: this.repo,
        state: options.state || 'open',
        per_page: 100,
        ...options
      });
      
      core.info(`成功获取到 ${issues.length} 个issues`);
      
      // 过滤掉pull request
      const filteredIssues = issues.filter(issue => !issue.pull_request);
      core.info(`过滤后剩余 ${filteredIssues.length} 个issues（排除PR）`);
      
      return filteredIssues;
    } catch (error) {
      core.error(`获取issues失败: ${error.message}`);
      core.error(`错误详情: ${JSON.stringify(error)}`);
      core.error(`API URL: ${error.request?.url || '未知'}`);
      core.error(`状态码: ${error.status || '未知'}`);
      throw error;
    }
  }

  /**
   * 获取带有特定标签的issue
   * @param {Array} labels - 标签名称数组
   * @returns {Promise<Array>} - Issue对象数组
   */
  async getIssuesWithLabels(labels) {
    core.info(`正在获取带有标签 ${labels.join(',')} 的issues`);
    try {
      const issues = await this.getIssues({ labels: labels.join(',') });
      core.info(`成功获取到 ${issues.length} 个带有标签 ${labels.join(',')} 的issues`);
      return issues;
    } catch (error) {
      core.error(`获取带有标签 ${labels.join(',')} 的issues失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取issue的评论
   * @param {number} issueNumber - Issue编号
   * @returns {Promise<Array>} - 评论对象数组
   */
  async getIssueComments(issueNumber) {
    const { data: comments } = await this.octokit.rest.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      per_page: 100
    });
    return comments;
  }

  /**
   * 获取API issue（带有'api'标签的issue）
   * @returns {Promise<Object>} - API issue对象
   */
  async getApiIssue() {
    const apiIssues = await this.getIssuesWithLabels(['api']);
    if (apiIssues.length === 0) {
      throw new Error('没有找到带有"api"标签的issue');
    }
    return apiIssues[0];
  }

  /**
   * 从API issue中获取API配置
   * @returns {Promise<Array>} - API配置数组
   */
  async getApiConfigs() {
    const apiIssue = await this.getApiIssue();
    const comments = await this.getIssueComments(apiIssue.number);
    
    // 在这里导入以避免循环依赖
    const { extractApiConfigs } = await import('./api-client.js');
    return extractApiConfigs(comments);
  }

  /**
   * 获取仓库中的所有讨论
   * @returns {Promise<Array>} - 讨论对象数组
   */
  async getDiscussions() {
    const query = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          discussions(first: 100) {
            nodes {
              id
              title
              body
              number
              category {
                name
              }
            }
          }
        }
      }
    `;

    const { repository } = await this.octokit.graphql(query, {
      owner: this.owner,
      repo: this.repo
    });

    return repository.discussions.nodes;
  }

  /**
   * 通过标题获取讨论
   * @param {string} title - 讨论标题
   * @returns {Promise<Object|null>} - 讨论对象，如果未找到则为null
   */
  async getDiscussionByTitle(title) {
    const discussions = await this.getDiscussions();
    return discussions.find(discussion => discussion.title === title) || null;
  }

  /**
   * 创建新讨论
   * @param {string} title - 讨论标题
   * @param {string} body - 讨论内容
   * @returns {Promise<Object>} - 创建的讨论对象
   */
  async createDiscussion(title, body) {
    // [新增] 首先，通过REST API获取仓库的完整信息，以得到正确的node_id
    core.info(`正在获取仓库 ${this.owner}/${this.repo} 的 node_id...`);
    const { data: repoData } = await this.octokit.rest.repos.get({
      owner: this.owner,
      repo: this.repo,
    });
    const repositoryId = repoData.node_id; // <-- 这是正确的、Base64编码的ID

    if (!repositoryId) {
      throw new Error(`无法获取仓库 ${this.owner}/${this.repo} 的 node_id`);
    }
    core.info(`成功获取到 repositoryId: ${repositoryId}`);
    // 首先，获取讨论分类ID
    const categoryQuery = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          discussionCategories(first: 10) {
            nodes {
              id
              name
            }
          }
        }
      }
    `;

    const { repository } = await this.octokit.graphql(categoryQuery, {
      owner: this.owner,
      repo: this.repo
    });

    const categories = repository.discussionCategories.nodes;
    if (categories.length === 0) {
      throw new Error('仓库中没有找到讨论分类');
    }

    // [修改] 不再使用第一个分类，而是按名称查找 "General" 分类
    core.info(`可用的讨论分类: ${categories.map(c => c.name).join(', ')}`);
    const generalCategory = categories.find(cat => cat.name === 'General');

    if (!generalCategory) {
      // 如果找不到 "General"，就报错并提示用户
      throw new Error('在仓库中没有找到名为 "General" 的讨论分类。请确保该分类存在。');
    }
    
    // 使用 "General" 分类的 ID
    const categoryId = generalCategory.id;
    core.info(`已选择分类 "General"，ID为: ${categoryId}`);

    // 创建讨论
    const createMutation = `
      mutation($input: CreateDiscussionInput!) {
        createDiscussion(input: $input) {
          discussion {
            id
            title
            body
            number
          }
        }
      }
    `;

    const { createDiscussion } = await this.octokit.graphql(createMutation, {
      input: {
        repositoryId: repositoryId, // [修改] 使用我们刚刚获取的正确ID
        categoryId,
        title,
        body
      }
    });

    return createDiscussion.discussion;
  }

  /**
   * 获取讨论的评论
   * @param {number} discussionNumber - 讨论编号
   * @returns {Promise<Array>} - 评论对象数组
   */
  async getDiscussionComments(discussionNumber) {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) {
            comments(first: 100) {
              nodes {
                id
                body
                createdAt
                author {
                  login
                }
                replies(first: 100) {
                  nodes {
                    id
                    body
                    createdAt
                    author {
                      login
                    }
                  }
                }
                reactions {
                  nodes {
                    content
                  }
                }
              }
            }
          }
        }
      }
    `;

    const { repository } = await this.octokit.graphql(query, {
      owner: this.owner,
      repo: this.repo,
      number: discussionNumber
    });

    return repository.discussion.comments.nodes;
  }

  /**
   * 向讨论添加评论
   * @param {string} discussionId - 讨论ID
   * @param {string} body - 评论内容
   * @returns {Promise<Object>} - 创建的评论对象
   */
  async addDiscussionComment(discussionId, body) {
    const mutation = `
      mutation($input: AddDiscussionCommentInput!) {
        addDiscussionComment(input: $input) {
          comment {
            id
            body
          }
        }
      }
    `;

    const { addDiscussionComment } = await this.octokit.graphql(mutation, {
      input: {
        discussionId,
        body
      }
    });

    return addDiscussionComment.comment;
  }

  /**
   * 向讨论评论添加回复
   * @param {string} commentId - 评论ID
   * @param {string} body - 回复内容
   * @returns {Promise<Object>} - 创建的回复对象
   */
  async addDiscussionReply(commentId, body) {
    const mutation = `
      mutation($input: AddDiscussionCommentReplyInput!) {
        addDiscussionCommentReply(input: $input) {
          reply {
            id
            body
          }
        }
      }
    `;

    const { addDiscussionCommentReply } = await this.octokit.graphql(mutation, {
      input: {
        commentId,
        body
      }
    });

    return addDiscussionCommentReply.reply;
  }

  /**
   * 向issue评论添加踩(👎)反应
   * @param {number} commentId - 评论ID
   * @returns {Promise<void>}
   */
  async addThumbsDownToIssueComment(commentId) {
    await this.octokit.rest.reactions.createForIssueComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId,
      content: '-1'
    });
  }

  /**
   * 检查评论是否有踩(👎)反应
   * @param {Object} comment - 评论对象
   * @returns {boolean} - 如果评论有踩(👎)反应则返回true
   */
  hasThumbsDownReaction(comment) {
    if (!comment.reactions) return false;
    return comment.reactions['-1'] > 0;
  }

  /**
   * 检查讨论评论是否有踩(👎)反应
   * @param {Object} comment - 讨论评论对象
   * @returns {boolean} - 如果评论有踩(👎)反应则返回true
   */
  hasDiscussionThumbsDownReaction(comment) {
    if (!comment.reactions || !comment.reactions.nodes) return false;
    return comment.reactions.nodes.some(reaction => reaction.content === 'THUMBS_DOWN');
  }

  /**
   * 向讨论评论添加踩(👎)反应
   * @param {string} commentId - 评论ID
   * @returns {Promise<void>}
   */
  async addThumbsDownToDiscussionComment(commentId) {
    const mutation = `
      mutation($input: AddReactionInput!) {
        addReaction(input: $input) {
          reaction {
            content
          }
        }
      }
    `;

    await this.octokit.graphql(mutation, {
      input: {
        subjectId: commentId,
        content: 'THUMBS_DOWN'
      }
    });
  }
} 