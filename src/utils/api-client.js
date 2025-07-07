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
    keys: [],
    type: 'openai' // 默认为 'openai' 以保持向后兼容
  };

  const lines = commentBody.split('\n');
  
  for (const line of lines) {
    const match = line.match(/^(.*?)[:：](.*?)$/);
    if (!match) continue;
    
    const [, key, value] = match;
    const trimmedKey = key.trim().toLowerCase();
    const trimmedValue = value.replace(/\r/g, '').trim().replace(/^['"]|['"]$/g, '');
    
    if (trimmedKey.includes('name')) {
      config.name = trimmedValue;
    } else if (trimmedKey.includes('url')) {
      config.url = trimmedValue;
    } else if (trimmedKey.includes('key')) {
      config.keys.push(trimmedValue);
    } else if (trimmedKey.includes('type')) {
      config.type = trimmedValue.toLowerCase();
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

function hasThumbsDownReaction(comment) {
  if (!comment.reactions) return false;
  return comment.reactions['-1'] > 0;
}

/**
 * 调用LLM API（兼容OpenAI和Gemini）并带有容错机制
 * @param {Array} apiConfigs - API配置数组
 * @param {string} prompt - 原始的prompt字符串
 * @returns {Promise<string>} - API响应中提取的文本
 */
export async function callLlmApi(apiConfigs, prompt) {
  if (!apiConfigs || apiConfigs.length === 0) {
    throw new Error('没有可用的API配置');
  }

  let lastError = null;

  for (const config of apiConfigs) {
    core.debug(`尝试使用模型: ${config.name} (类型: ${config.type})`);
    
    const requestData = formatApiRequest(prompt, config);
    
    for (const key of config.keys) {
      try {
        let url = config.url;
        const headers = { 'Content-Type': 'application/json' };

        if (config.type === 'gemini') {
          url = `${config.url}?key=${key}`;
        } else {
          headers['Authorization'] = `Bearer ${key}`;
        }
        
        const response = await axios.post(url, requestData, { headers, timeout: 60000 });
        
        core.debug(`API调用成功，使用模型: ${config.name}`);
        return extractGeneratedText(response.data, config.type);
      } catch (error) {
        lastError = error;
        core.debug(`API调用失败，模型: ${config.name}, 密钥: ${key.substring(0, 3)}***, 错误: ${error.message}`);
      }
    }
  }

  throw new Error(`所有API调用都失败了。最后一个错误: ${lastError?.message || '未知错误'}`);
}

/**
 * 根据提示和API类型格式化API请求
 * @param {string} prompt - 发送到API的提示
 * @param {Object} config - 当前API的配置对象
 * @returns {Object} - 格式化的请求数据
 */
export function formatApiRequest(prompt, config) {
  if (config.type === 'gemini') {
    return {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 20000 }
    };
  } else { // 默认或 'openai'
    return {
      model: config.name,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 20000
    };
  }
}

/**
 * 从API响应中提取生成的文本
 * @param {Object} apiResponse - API响应对象
 * @param {string} type - API类型 ('openai' 或 'gemini')
 * @returns {string} - 提取的文本
 */
export function extractGeneratedText(apiResponse, type) {
  try {
    if (type === 'gemini') {
      if (apiResponse.candidates?.length > 0) {
        return apiResponse.candidates[0].content.parts[0].text;
      }
      core.warning('Gemini 响应中未找到 candidates，可能已被安全策略阻止。');
    } else { // 默认或 'openai'
      if (apiResponse.choices?.length > 0) {
        return apiResponse.choices[0].message?.content || apiResponse.choices[0].text || '';
      }
    }
    return JSON.stringify(apiResponse);
  } catch (error) {
    core.warning(`从API响应中提取文本失败: ${error.message}`);
    return JSON.stringify(apiResponse);
  }
}