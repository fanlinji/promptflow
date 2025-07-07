// src/utils/api-client.js

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
    const match = line.match(/^(.*?)[:：](.*?)$/);
    if (!match) continue;
    
    const [, key, value] = match;
    const trimmedKey = key.trim().toLowerCase();
    // [修改] 增强了对回车符\r的清理
    const trimmedValue = value.replace(/\r/g, '').trim().replace(/^['"]|['"]$/g, '');
    
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
  const sortedComments = [...comments].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  
  for (const comment of sortedComments) {
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
 * @returns {boolean}
 */
function hasThumbsDownReaction(comment) {
  if (!comment.reactions) return false;
  return comment.reactions['-1'] > 0;
}

/**
 * 调用LLM API并带有容错机制
 * @param {Array} apiConfigs - API配置数组
 * @param {string} prompt - [修改] 直接接收原始的prompt字符串
 * @returns {Promise<Object>} - API响应
 */
export async function callLlmApi(apiConfigs, prompt) {
  if (!apiConfigs || apiConfigs.length === 0) {
    throw new Error('没有可用的API配置');
  }

  let lastError = null;

  for (const config of apiConfigs) {
    core.debug(`尝试使用模型: ${config.name}`);
    
    // [修改] 在循环内部，根据当前模型动态创建请求数据
    const requestData = formatApiRequest(prompt, config.name);
    
    for (const key of config.keys) {
      try {
        const response = await axios.post(config.url, requestData, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          timeout: 60000 
        });
        
        core.debug(`API调用成功，使用模型: ${config.name}`);
        return response.data;
      } catch (error) {
        lastError = error;
        core.debug(`API调用失败，模型: ${config.name}, 密钥: ${key.substring(0, 3)}***, 错误: ${error.message}`);
      }
    }
  }

  throw new Error(`所有API调用都失败了。最后一个错误: ${lastError?.message || '未知错误'}`);
}

/**
 * 根据提示格式化API请求
 * @param {string} prompt - 发送到API的提示
 * @param {string} modelName - [修改] 增加modelName参数
 * @returns {Object} - 格式化的请求数据
 */
export function formatApiRequest(prompt, modelName) {
  return {
    model: modelName, // [修改] 使用传入的modelName
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
    if (apiResponse.choices && apiResponse.choices.length > 0) {
      if (apiResponse.choices[0].message) {
        return apiResponse.choices[0].message.content;
      } else if (apiResponse.choices[0].text) {
        return apiResponse.choices[0].text;
      }
    }
    return JSON.stringify(apiResponse);
  } catch (error) {
    core.warning(`从API响应中提取文本失败: ${error.message}`);
    return JSON.stringify(apiResponse);
  }
}