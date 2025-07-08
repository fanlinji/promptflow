// src/utils/api-client.js

import axios from 'axios';
import * as core from '@actions/core';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
 * [重写] 调用 LLM API，优先处理文件
 * @param {Object} config - 当前使用的API配置
 * @param {string} prompt - 文本提示
 * @param {Buffer} [fileBuffer] - 可选的文件二进制数据
 * @param {string} [mimeType] - 可选的文件的MIME类型
 * @returns {Promise<string>} - API响应中提取的文本
 */
export async function callLlmApi(apiConfigs, prompt, fileBuffer, mimeType) {
  core.info(`[关键日志 2] callLlmApi 收到的最终配置列表: ${JSON.stringify(apiConfigs, null, 2)}`);

  const geminiConfig = apiConfigs.find(c => c.type === 'gemini');
  if (!geminiConfig || geminiConfig.keys.length === 0) {
    throw new Error('当前实现只支持带有有效key的Gemini File API');
  }
  const apiKey = geminiConfig.keys[0];
  const modelName = geminiConfig.name;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });
    const promptParts = [{ text: prompt }];

    if (fileBuffer && mimeType) {
      core.info(`正在准备上传 ${mimeType} 文件...`);
      promptParts.push({ inlineData: { data: fileBuffer.toString("base64"), mimeType } });
    }
    
    const result = await model.generateContent({ contents: [{ role: "user", parts: promptParts }] });
    const response = result.response;
    const text = response.text();
    core.info('成功从 Gemini 获取到内容。');
    return text;
  } catch (error) {
    core.error(`调用 Gemini API 失败: ${error.message}`);
    throw error;
  }
}
