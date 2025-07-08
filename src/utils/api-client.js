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
 * [重写] 调用LLM API，支持多配置和多Key容错
 * @param {Array} apiConfigs - 所有API配置
 * @param {string} prompt - 文本提示
 * @param {Buffer} [fileBuffer] - 可选的文件二进制数据
 * @param {string} [mimeType] - 可选的文件的MIME类型
 * @returns {Promise<string>} - API响应中提取的文本
 */
export async function callLlmApi(apiConfigs, prompt, fileBuffer, mimeType) {
  if (!apiConfigs || apiConfigs.length === 0) {
    throw new Error('没有可用的API配置');
  }

  // [修改] 筛选出所有 type 为 'gemini' 的配置，而不仅仅是第一个
  const geminiConfigs = apiConfigs.filter(c => c.type === 'gemini');
  if (geminiConfigs.length === 0) {
    throw new Error('没有找到类型为 "gemini" 的有效API配置');
  }

  let lastError = null;

  // 外层循环：遍历所有 Gemini 配置
  for (const config of geminiConfigs) {
    core.info(`准备使用模型配置: ${config.name}`);

    // 内层循环：遍历当前配置下的所有 Key
    for (const apiKey of config.keys) {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: config.name });

        const promptParts = [{ text: prompt }];

        if (fileBuffer && mimeType) {
          core.info(`正在准备上传 ${mimeType} 文件...`);
          promptParts.push({
            inlineData: {
              data: fileBuffer.toString("base64"),
              mimeType,
            },
          });
        }
        
        const result = await model.generateContent({
            contents: [{ role: "user", parts: promptParts }]
        });

        const response = result.response;
        const text = response.text();
        
        core.info(`API 调用成功，使用模型: ${config.name}`);
        return text; // 成功后立刻返回结果，中断所有循环

      } catch (error) {
        lastError = error;
        core.warning(`使用模型 ${config.name} 和 Key(***${apiKey.slice(-4)}) 调用失败: ${error.message}`);
        // 不抛出错误，继续尝试下一个 Key
      }
    }
    // 如果一个配置下的所有 Key 都失败了，会继续尝试下一个配置
  }

  // 如果所有配置的所有 Key 都失败了，才最终抛出错误
  throw new Error(`所有 Gemini API 调用都失败了。最后一个错误: ${lastError?.message || '未知错误'}`);
}
