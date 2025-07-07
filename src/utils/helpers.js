import * as core from '@actions/core';

/**
 * 使用正则表达式从评论内容中提取提示
 * @param {string} commentBody - 评论内容
 * @returns {Object|null} - 包含类型和内容的对象，如果没有匹配则为null
 */
export function extractPrompt(commentBody) {
  // 匹配英文和中文冒号
  const regex = /^(\w+Prompt)[:：]([\s\S]*)$/;
  const match = commentBody.match(regex);
  
  if (!match) {
    return null;
  }
  
  return {
    type: match[1],
    content: match[2].trim()
  };
}

/**
 * 用实际内容替换模板中的占位符
 * @param {string} template - 带有占位符的模板字符串
 * @param {string} content - 用于替换占位符的内容
 * @returns {string} - 替换占位符后的模板
 */
export function fillTemplate(template, content) {
  // 检查模板是否包含占位符
  if (!template.includes('{{文章}}')) {
    // 如果没有，将内容追加到末尾
    return `${template} {{文章}}`.replace('{{文章}}', content);
  }
  
  // 用内容替换占位符
  return template.replace('{{文章}}', content);
}

/**
 * 记录错误并将操作标记为失败
 * @param {Error} error - 错误对象
 * @param {string} message - 错误消息
 */
export function handleError(error, message) {
  const errorMessage = `${message}: ${error.message}`;
  core.error(errorMessage);
  
  // 记录更详细的错误信息
  if (error.response) {
    core.error(`HTTP状态码: ${error.response.status}`);
    core.error(`响应头: ${JSON.stringify(error.response.headers)}`);
    core.error(`响应体: ${JSON.stringify(error.response.data)}`);
  }
  
  if (error.request) {
    core.error(`请求URL: ${error.request.url || '未知'}`);
    core.error(`请求方法: ${error.request.method || '未知'}`);
  }
  
  // 记录错误堆栈
  if (error.stack) {
    core.error(`错误堆栈: ${error.stack}`);
  }
  
  core.setFailed(errorMessage);
}

/**
 * 休眠指定时间
 * @param {number} ms - 休眠的毫秒数
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 使用指数退避重试函数
 * @param {Function} fn - 要重试的函数
 * @param {number} maxRetries - 最大重试次数
 * @param {number} initialDelay - 初始延迟（毫秒）
 * @returns {Promise<any>} - 函数的结果
 */
export async function retry(fn, maxRetries = 3, initialDelay = 1000) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const delay = initialDelay * Math.pow(2, i);
      core.debug(`重试 ${i + 1}/${maxRetries} 失败。将在 ${delay}毫秒后重试...`);
      await sleep(delay);
    }
  }
  
  throw lastError;
} 