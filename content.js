// 全局变量，用于存储配置
let topicsConfig = [];
let lastApiCallTime = 0;
const API_CALL_INTERVAL = 5000; // 5秒钟的间隔

// 节流函数
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

// 函数用于检查扩展是否有效
function isExtensionValid() {
    return true;
}

// 函数用于获取配置
async function getConfig() {
    if (!isExtensionValid()) {
        console.error("Extension context is invalid. Reloading page...");
        setTimeout(() => window.location.reload(), 1000);
        return null;
    }

    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(['topicsConfig'], (result) => {
                if (chrome.runtime.lastError) {
                    console.error("Error fetching topicsConfig:", chrome.runtime.lastError);
                    resolve([]);
                } else {
                    resolve(result.topicsConfig || []);
                }
            });
        } catch (e) {
            console.error("Error accessing chrome.storage:", e);
            resolve([]);
        }
    });
}

// 修改后的 checkForNewPosts 函数
async function checkForNewPosts() {
    try {
        if (!isExtensionValid()) {
            console.error("Extension context is invalid. Aborting check.");
            return;
        }

        const currentTime = Date.now();
        if (currentTime - lastApiCallTime < API_CALL_INTERVAL) {
            console.log("Skipping API call due to rate limiting");
            return;
        }

        // 获取最新的 topicsConfig
        const config = await getConfig();
        if (config === null) return; // 扩展无效，页面将重新加载
        topicsConfig = config;

        // 如果配置项数量为0，不进行任何处理
        if (topicsConfig.length === 0) {
            console.log("No topics configured. Skipping analysis.");
            return;
        }

        // Early check for API key
        const apiKey = await getGroqApiKey();
        if (!apiKey) {
            console.log("API key not configured. Please set up your Groq API key in the extension options.");
            return;
        }

        const posts = document.querySelectorAll('[data-testid="cellInnerDiv"]');

        posts.forEach(async post => {
            const tweetArticle = post.querySelector('article[data-testid="tweet"]');
            if (!tweetArticle) return;

            const postId = Array.from(tweetArticle.querySelectorAll('a'))
                .find(a => a.href.includes('/status/'))
                ?.href.split('/')
                .find((part, index, array) => array[index - 1] === 'status');
            const postTextElement = tweetArticle.querySelector('[data-testid="tweetText"]');
            const postText = postTextElement ? postTextElement.innerText.trim() : '';
            
            if (postId) {
                let analysis = await getCachedAnalysis(postId);
                if (!analysis) {
                    analysis = await analyzeTweet(postText, apiKey);
                    await cacheAnalysis(postId, analysis);
                }
                applyPostVisibility(postId, analysis);
            }
        });

        lastApiCallTime = currentTime;

    } catch (error) {
        console.error("Error in checkForNewPosts:", error);
        if (error.message.includes("Extension context invalidated")) {
            console.log("Extension context invalidated. Reloading page...");
            setTimeout(() => window.location.reload(), 1000);
        }
    }
}

// 节流版的 checkForNewPosts
const throttledCheckForNewPosts = throttle(checkForNewPosts, API_CALL_INTERVAL);

// Function to get cached analysis
async function getCachedAnalysis(postId) {
    return new Promise((resolve) => {
        chrome.storage.local.get([`analysis_${postId}`], result => {
            resolve(result[`analysis_${postId}`] || null);
        });
    });
}

// Function to cache analysis
async function cacheAnalysis(postId, analysis) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [`analysis_${postId}`]: analysis }, resolve);
    });
}

// Function to apply post visibility based on analysis
function applyPostVisibility(postId, analysis) {
    if (typeof analysis === 'object' && analysis !== null) {
        const shouldHide = topicsConfig.some(topic => 
            topic.topic in analysis && analysis[topic.topic] > topic.threshold
        );

        if (shouldHide) {
            const postElement = findPostElement(postId);
            if (postElement) {
                if (postElement.style.display !== 'none') {
                    postElement.style.display = 'none';
                    const tweetUrl = `https://x.com/user/status/${postId}`;
                    const tweetText = postElement.querySelector('[data-testid="tweetText"]')?.innerText.trim() || 'Text not found';
                    console.log(`Post ${postId} hidden due to high scores:`);
                    topicsConfig.forEach(topic => {
                        if (topic.topic in analysis) {
                            console.log(`${topic.topic}: ${analysis[topic.topic]}`);
                        }
                    });
                    console.log(`Tweet URL: ${tweetUrl}`);
                    console.log(`Tweet Text: ${tweetText}`);
                }
            } else {
                console.log(`Could not find element for post ${postId} to hide`);
            }
        }
    } else {
        console.log(`Skipping post ${postId} due to invalid analysis result`);
    }
}

// Function to find the div element containing a specific post ID
function findPostElement(postId) {
    if (typeof postId !== 'string') {
        throw new Error('postId must be a string');
    }
    const cellInnerDivs = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    
    for (const div of cellInnerDivs) {
        const link = div.querySelector(`a[href*="/status/${postId}"]`);
        if (link) {
            return div;
        }
    }
    
    return null; // Return null if no matching element is found
}
window.findPostElement = findPostElement;

// Function to reset the cache (seenPostIds and analysis results)
function resetCache() {
    chrome.storage.local.get(null, (items) => {
        const allKeys = Object.keys(items);
        const analysisKeys = allKeys.filter(key => key.startsWith('analysis_'));
        chrome.storage.local.remove(analysisKeys, () => {
            console.log('Cache (analysis results) has been reset.');
        });
    });
}

// Make resetCache function available in the global scope
window.resetCache = resetCache;

console.log('To reset the cache, run resetCache() in the console.');

// Function to analyze a tweet using the Groq API
async function analyzeTweet(tweetText, apiKey) {
    let retries = 0;
    const maxRetries = 3;
    const messages = [
        {
            role: "system",
            content: `Your task is to evaluate Tweets/X posts. Always respond in JSON. Follow this format:\n\n{\n${topicsConfig.map(topic => `    "${topic.topic}": 0.0`).join(',\n')}\n}\n\nRate the provided post from 0.0 to 1.0 for each topic. Here are the descriptions for each topic:\n\n${topicsConfig.map(topic => `${topic.topic}: ${topic.description}`).join('\n')}`
        },
        {
            role: "user",
            content: tweetText
        }
    ];

    while (retries < maxRetries) {
        try {
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    messages: messages,
                    model: "llama-3.1-8b-instant",
                    temperature: 1,
                    max_tokens: 1024,
                    top_p: 1,
                    stream: false,
                    response_format: {
                        type: "json_object"
                    },
                    stop: null
                })
            });

            if (response.status === 400) {
                retries++;
                continue;
            }

            const data = await response.json();
            return JSON.parse(data.choices[0].message.content);
        } catch (error) {
            retries++;
            if (retries === maxRetries) {
                console.error("Max retries reached. Returning empty object.");
                return {};
            }
        }
    }

    return {};
}

// Function to get or set the Groq API key
async function getGroqApiKey() {
    if (!isExtensionValid()) {
        console.error("Extension context is invalid. Aborting API key fetch.");
        return null;
    }

    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(['GROQ_API_KEY'], (result) => {
                if (chrome.runtime.lastError) {
                    console.error("Error fetching API key:", chrome.runtime.lastError);
                    resolve(null);
                } else {
                    resolve(result.GROQ_API_KEY || null);
                }
            });
        } catch (e) {
            console.error("Error accessing chrome.storage for API key:", e);
            resolve(null);
        }
    });
}

// 修改事件监听器
function addScrollListener() {
    window.removeEventListener('scroll', scrollHandler); // 移除旧的监听器
    window.addEventListener('scroll', scrollHandler);
}

function scrollHandler() {
    if (window.location.hostname === 'x.com' || window.location.hostname === 'twitter.com') {
        throttledCheckForNewPosts();
    }
}

// 初始化
function initialize() {
    if (window.location.hostname === 'x.com' || window.location.hostname === 'twitter.com') {
        throttledCheckForNewPosts();
        addScrollListener();
    }
}

// 使用 setTimeout 来确保在页面加载完成后初始化
setTimeout(initialize, 1000);

// 定期检查扩展上下文是否有效
setInterval(() => {
    if (!isExtensionValid()) {
        console.log("Extension context became invalid. Reloading page...");
        setTimeout(() => window.location.reload(), 1000);
    }
}, 60000); // 每分钟检查一次