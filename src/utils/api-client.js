import axios from 'axios';
import * as core from '@actions/core';

/**
 * 从issue评论中解析API配置
 * @param {string} commentBody - 评论内容
 * @returns {Object} - 解析后的API配置
 */
export function parseApiConfig(commentBody) {
  const config = {
    name: '',
    url: '',
    keys: []
  };

  const lines = commentBody.split('\n');
  
  for (const line of lines) {
    // 匹配英文和中文冒号
    const match = line.match(/^(.*?)[:：](.*?)$/);
    if (!match) continue;
    
    const [, key, value] = match;
    const trimmedKey = key.trim().toLowerCase();
    const trimmedValue = value.trim().replace(/^['"]|['"]$/g, ''); // 移除引号
    
    if (trimmedKey.includes('name')) {
      config.name = trimmedValue;
    } else if (trimmedKey.includes('url')) {
      config.url = trimmedValue;
    } else if (trimmedKey.includes('key')) {
      config.keys.push(trimmedValue);
    }
  }
  
  return config;
}

/**
 * 从issue评论中提取API配置
 * @param {Array} comments - 评论对象数组
 * @returns {Array} - API配置数组
 */
export function extractApiConfigs(comments) {
  const configs = [];
  
  // 按创建时间排序评论
  const sortedComments = [...comments].sort((a, b) => 
    new Date(a.created_at) - new Date(b.created_at)
  );
  
  for (const comment of sortedComments) {
    // 跳过带有踩(👎)反应的评论
    if (hasThumbsDownReaction(comment)) {
      continue;
    }
    
    const config = parseApiConfig(comment.body);
    if (config.url && config.name && config.keys.length > 0) {
      configs.push(config);
    }
  }
  
  return configs;
}

/**
 * 检查评论是否有踩(👎)反应
 * @param {Object} comment - 评论对象
 * @returns {boolean} - 如果评论有踩(👎)反应则返回true
 */
function hasThumbsDownReaction(comment) {
  if (!comment.reactions) return false;
  return comment.reactions['-1'] > 0;
}

/**
 * 调用LLM API并带有容错机制
 * @param {Array} apiConfigs - API配置数组
 * @param {Object} requestData - API请求数据
 * @returns {Promise<Object>} - API响应
 */
export async function callLlmApi(apiConfigs, requestData) {
  if (!apiConfigs || apiConfigs.length === 0) {
    throw new Error('没有可用的API配置');
  }

  let lastError = null;

  // 按顺序尝试每个模型
  for (const config of apiConfigs) {
    core.debug(`尝试使用模型: ${config.name}`);
    
    // 尝试当前模型的每个密钥
    for (const key of config.keys) {
      try {
        const response = await axios.post(config.url, requestData, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          timeout: 60000 // 60秒超时
        });
        
        core.debug(`API调用成功，使用模型: ${config.name}`);
        return response.data;
      } catch (error) {
        lastError = error;
        core.debug(`API调用失败，模型: ${config.name}, 密钥: ${key.substring(0, 3)}***, 错误: ${error.message}`);
        // 继续尝试下一个密钥或模型
      }
    }
  }

  // 如果执行到这里，所有模型和密钥都已失败
  throw new Error(`所有API调用都失败了。最后一个错误: ${lastError?.message || '未知错误'}`);
}

/**
 * 根据提示格式化API请求
 * @param {string} prompt - 发送到API的提示
 * @returns {Object} - 格式化的请求数据
 */
export function formatApiRequest(prompt) {
  return {
    model: "gpt-3.5-turbo", // 这将被API端点覆盖
    messages: [
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.7,
    max_tokens: 2000
  };
}

/**
 * 从API响应中提取生成的文本
 * @param {Object} apiResponse - API响应对象
 * @returns {string} - 提取的文本
 */
export function extractGeneratedText(apiResponse) {
  try {
    // 处理不同的API响应格式
    if (apiResponse.choices && apiResponse.choices.length > 0) {
      if (apiResponse.choices[0].message) {
        return apiResponse.choices[0].message.content;
      } else if (apiResponse.choices[0].text) {
        return apiResponse.choices[0].text;
      }
    }
    
    // 备用方案：返回字符串化的响应
    return JSON.stringify(apiResponse);
  } catch (error) {
    core.warning(`从API响应中提取文本失败: ${error.message}`);
    return JSON.stringify(apiResponse);
  }
} 