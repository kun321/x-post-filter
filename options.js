let topics = [
    {"topic": "politics", "description": "posts about political subjects", "threshold": 0.8},
    {"topic": "negativity", "description": "posts with overly negative sentiment", "threshold": 0.9}
];
let editingIndex = -1;

function loadConfig() {
    chrome.storage.local.get(['GROQ_API_KEY', 'topicsConfig'], (result) => {
        if (result.GROQ_API_KEY) {
            document.getElementById('apiKey').value = result.GROQ_API_KEY;
        }
        if (result.topicsConfig && Array.isArray(result.topicsConfig)) {
            topics = result.topicsConfig;
        }
        renderTopics();
    });
}

function renderTopics() {
    const topicsList = document.getElementById('topicsList');
    topicsList.innerHTML = '';
    topics.forEach((topic, index) => {
        const topicItem = document.createElement('div');
        topicItem.className = 'topic-item';
        topicItem.innerHTML = `
            <div class="topic-header">
                <span class="topic-title">${topic.topic}</span>
                <div class="topic-actions">
                    <button class="edit-btn" data-index="${index}">Edit</button>
                    <button class="delete-btn" data-index="${index}">Remove</button>
                </div>
            </div>
            <div class="topic-description">${topic.description}</div>
            <div class="topic-threshold">Threshold: ${topic.threshold}</div>
        `;
        topicsList.appendChild(topicItem);
    });

    // 添加事件监听器
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => editTopic(parseInt(e.target.dataset.index)));
    });
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => removeTopic(parseInt(e.target.dataset.index)));
    });
}

function updateTopic(index, field, value) {
    topics[index][field] = field === 'threshold' ? parseFloat(value) : value;
    renderTopics();
    saveConfig();
}

function removeTopic(index) {
    topics.splice(index, 1);
    renderTopics();
    saveConfig();
}

function editTopic(index) {
    const topic = topics[index];
    document.getElementById('topicInput').value = topic.topic;
    document.getElementById('descriptionInput').value = topic.description;
    document.getElementById('thresholdInput').value = topic.threshold;
    document.getElementById('topicForm').style.display = 'block';
    editingIndex = index;
}

document.getElementById('addTopic').addEventListener('click', () => {
    document.getElementById('topicForm').style.display = 'block';
    document.getElementById('topicInput').value = '';
    document.getElementById('descriptionInput').value = '';
    document.getElementById('thresholdInput').value = '0.5';
    editingIndex = -1;
});

document.getElementById('submitTopic').addEventListener('click', () => {
    const topic = document.getElementById('topicInput').value;
    const description = document.getElementById('descriptionInput').value;
    const threshold = parseFloat(document.getElementById('thresholdInput').value);
    
    if (editingIndex === -1) {
        topics.push({ topic, description, threshold });
    } else {
        topics[editingIndex] = { topic, description, threshold };
    }
    
    document.getElementById('topicForm').style.display = 'none';
    renderTopics();
    saveConfig();
});

document.getElementById('cancelTopic').addEventListener('click', () => {
    document.getElementById('topicForm').style.display = 'none';
});

function saveConfig() {
    const apiKey = document.getElementById('apiKey').value;
    chrome.storage.local.set({
        GROQ_API_KEY: apiKey,
        topicsConfig: topics
    }, () => {
        if (chrome.runtime.lastError) {
            console.error('Error saving config:', chrome.runtime.lastError);
        } else {
            console.log('Configuration saved successfully');
        }
    });
}

document.getElementById('saveConfig').addEventListener('click', () => {
    saveConfig();
    
});

// 初始加载配置
loadConfig();