const MSG_GET_USER_PHONENUMBER = "MSG_GET_USER_PHONENUMBER";
const MSG_GET_PAGE_URL = "MSG_GET_PAGE_URL";
const MSG_SEND_MESSAGE = "MSG_SEND_MESSAGE";

// BULK MESSAGE
const KEY_PHONE_NUMBERS_BULK = "KEY_PHONE_NUMBERS_BULK";
const KEY_CURRENT_MSG_BULK = "KEY_CURRENT_MSG_BULK";
const KEY_BULK_MSG_COUNTRYCODE = "KEY_BULK_MSG_COUNTRYCODE";

// INDIVIDUAL MESSAGE
const KEY_PHONE_NUMBERS_INDIVIDUAL = "KEY_PHONE_NUMBERS_INDIVIDUAL";
const KEY_CURRENT_MSG_INDIVIDUAL = "KEY_CURRENT_MSG_INDIVIDUAL";

const KEY_PHONE_NUMBER = "KEY_PHONE_NUMBER";
const KEY_CURRENT_MSG = "KEY_CURRENT_MSG";

// Message History Tracking
const KEY_MESSAGE_HISTORY = "KEY_MESSAGE_HISTORY";
const SKIP_DAYS = 3; // Skip numbers contacted in past 3 days

// Stop flags for message sending
let stopSendingBulk = false;
let stopSendingIndividual = false;

// Human-like typing simulation functions
function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Message History Management Functions
async function addToMessageHistory(phoneNumber, message) {
    try {
        const history = await getMessageHistory();
        const timestamp = Date.now();
        
        // Add new entry
        history[phoneNumber] = {
            lastSent: timestamp,
            message: message.substring(0, 100), // Store first 100 chars for reference
            count: (history[phoneNumber]?.count || 0) + 1
        };
        
        // Clean up old entries (older than SKIP_DAYS)
        const cutoffTime = timestamp - (SKIP_DAYS * 24 * 60 * 60 * 1000);
        Object.keys(history).forEach(number => {
            if (history[number].lastSent < cutoffTime) {
                delete history[number];
            }
        });
        
        // Save updated history
        await new Promise(resolve => {
            chrome.storage.local.set({[KEY_MESSAGE_HISTORY]: JSON.stringify(history)}, resolve);
        });
        
        console.log(`📝 Added ${phoneNumber} to message history`);
    } catch (error) {
        console.error('Error adding to message history:', error);
    }
}

async function getMessageHistory() {
    try {
        const result = await new Promise(resolve => {
            chrome.storage.local.get(KEY_MESSAGE_HISTORY, resolve);
        });
        
        const historyStr = result[KEY_MESSAGE_HISTORY];
        return historyStr ? JSON.parse(historyStr) : {};
    } catch (error) {
        console.error('Error getting message history:', error);
        return {};
    }
}

async function shouldSkipNumber(phoneNumber) {
    try {
        const history = await getMessageHistory();
        const entry = history[phoneNumber];
        
        if (!entry) {
            return false; // No history, don't skip
        }
        
        const daysSince = (Date.now() - entry.lastSent) / (24 * 60 * 60 * 1000);
        const shouldSkip = daysSince < SKIP_DAYS;
        
        if (shouldSkip) {
            console.log(`⏭️  Skipping ${phoneNumber} - contacted ${daysSince.toFixed(1)} days ago`);
        }
        
        return shouldSkip;
    } catch (error) {
        console.error('Error checking if should skip number:', error);
        return false; // If error, don't skip
    }
}

async function getSkippedNumbers(phoneNumbers) {
    const skipped = [];
    const toSend = [];
    
    for (const numberData of phoneNumbers) {
        const phoneNumber = typeof numberData === 'string' ? numberData : numberData.number;
        
        if (await shouldSkipNumber(phoneNumber)) {
            skipped.push(numberData);
        } else {
            toSend.push(numberData);
        }
    }
    
    return { skipped, toSend };
}

// Manual Checker Functions
async function checkAndRemoveRecentNumbers() {
    try {
        const rawInput = $("#inputNumbersBulk").val();
        if (!rawInput.trim()) {
            alert("Сначала введите номера телефонов для проверки.");
            return;
        }
        
        console.log("🔍 Checking numbers for recent contacts...");
        
        // Parse current input
        const inputLines = rawInput.split("\n");
        const allNumbers = [];
        
        inputLines.forEach(line => {
            const trimmedLine = line.trim();
            if (!trimmedLine) return;
            
            const splitValue = trimmedLine.split(",");
            const phoneNumber = splitValue[0] ? splitValue[0].trim().replace('+', '') : '';
            
            if (phoneNumber && phoneNumber.replace(/\D/g, '').length >= 7) {
                allNumbers.push({
                    originalLine: line,
                    number: phoneNumber,
                    valueOne: splitValue[1] ? splitValue[1].trim() : '',
                    valueTwo: splitValue[2] ? splitValue[2].trim() : ''
                });
            }
        });
        
        if (allNumbers.length === 0) {
            alert("Не найдено валидных номеров телефонов.");
            return;
        }
        
        // Check against message history
        const { skipped, toSend } = await getSkippedNumbers(allNumbers);
        
        if (skipped.length === 0) {
            alert(`✅ Отлично! Все ${allNumbers.length} номеров готовы к отправке.\nНикто из них не получал сообщения в последние ${SKIP_DAYS} дня.`);
            return;
        }
        
        // Show detailed results
        let message = `📊 Результаты проверки:\n\n`;
        message += `📱 Всего номеров: ${allNumbers.length}\n`;
        message += `✅ Готовы к отправке: ${toSend.length}\n`;
        message += `⏭️  Недавно контактировали: ${skipped.length}\n\n`;
        
        if (skipped.length > 0) {
            message += `Номера для удаления (контакт в последние ${SKIP_DAYS} дня):\n`;
            skipped.forEach((item, index) => {
                const number = typeof item === 'string' ? item : item.number;
                message += `${index + 1}. ${number}\n`;
            });
            message += `\nУдалить эти номера из списка?`;
        }
        
        const shouldRemove = confirm(message);
        
        if (shouldRemove) {
            // Reconstruct input with only non-skipped numbers
            const newLines = toSend.map(item => item.originalLine);
            const newInput = newLines.join('\n');
            
            $("#inputNumbersBulk").val(newInput);
            
            // Trigger input event to update internal arrays
            $("#inputNumbersBulk").trigger('input');
            
            alert(`✅ Готово!\n\nУдалено: ${skipped.length} номеров\nОсталось: ${toSend.length} номеров\n\nСписок обновлен и готов к отправке.`);
            
            console.log(`🧹 Removed ${skipped.length} recent contacts, ${toSend.length} numbers remaining`);
        }
        
    } catch (error) {
        console.error("❌ Error checking recent numbers:", error);
        alert("Произошла ошибка при проверке номеров. Попробуйте снова.");
    }
}

// Typing personality profiles - BALANCED SPEED
const TYPING_PERSONALITIES = {
    FAST: {
        name: "Быстрый печатник",
        shortWords: [25, 45],     // Fast but not too fast
        mediumWords: [35, 60],    // Fast but not too fast
        longWords: [40, 75],      // Fast but not too fast
        pauseChance: 0.08,        // Few pauses (8%)
        pauseTime: [80, 200],     // Short pauses
        thinkingTime: [400, 800]  // Quick thinking
    },
    MEDIUM: {
        name: "Обычный печатник", 
        shortWords: [35, 55],     // Moderate speed
        mediumWords: [45, 75],    // Moderate speed
        longWords: [55, 95],      // Moderate speed
        pauseChance: 0.12,        // Some pauses (12%)
        pauseTime: [150, 350],    // Medium pauses
        thinkingTime: [600, 1200] // Normal thinking
    },
    SLOW: {
        name: "Медленный печатник",
        shortWords: [50, 85],     // Slower but reasonable
        mediumWords: [65, 110],   // Slower but reasonable
        longWords: [80, 140],     // Slower but reasonable
        pauseChance: 0.18,        // More pauses (18%)
        pauseTime: [200, 500],    // Medium pauses
        thinkingTime: [800, 1500] // More thinking
    },
    INCONSISTENT: {
        name: "Непостоянный печатник",
        shortWords: [25, 70],     // Variable speed
        mediumWords: [35, 90],    // Variable speed
        longWords: [45, 120],     // Variable speed
        pauseChance: 0.15,        // Some pauses (15%)
        pauseTime: [120, 400],    // Variable pauses
        thinkingTime: [500, 1100] // Variable thinking
    }
};

// Select random typing personality
function getRandomTypingPersonality() {
    const personalities = Object.keys(TYPING_PERSONALITIES);
    const weights = [25, 40, 20, 15]; // Fast: 25%, Medium: 40%, Slow: 20%, Inconsistent: 15%
    
    const random = Math.random() * 100;
    let cumulative = 0;
    
    for (let i = 0; i < personalities.length; i++) {
        cumulative += weights[i];
        if (random <= cumulative) {
            return personalities[i];
        }
    }
    
    return 'MEDIUM'; // Fallback
}

function getTypingSpeed(word, personality = 'MEDIUM') {
    const profile = TYPING_PERSONALITIES[personality];
    const wordLength = word.length;
    
    let speedRange;
    if (wordLength <= 3) {
        speedRange = profile.shortWords;
    } else if (wordLength <= 7) {
        speedRange = profile.mediumWords;
    } else {
        speedRange = profile.longWords;
    }
    
    return getRandomDelay(speedRange[0], speedRange[1]);
}

function simulateHumanPauses(personality = 'MEDIUM') {
    const profile = TYPING_PERSONALITIES[personality];
    return getRandomDelay(profile.thinkingTime[0], profile.thinkingTime[1]);
}

function calculateMessageTypingTime(message, personality = 'MEDIUM') {
    const profile = TYPING_PERSONALITIES[personality];
    const words = message.split(' ');
    let totalTime = 0;
    
    words.forEach((word, index) => {
        // Add typing time for each character in the word
        for (let i = 0; i < word.length; i++) {
            totalTime += getTypingSpeed(word, personality);
        }
        
        // Add space typing time (balanced)
        if (index < words.length - 1) {
            totalTime += getRandomDelay(20, 40);
        }
        
        // Random pauses between some words based on personality
        if (Math.random() < profile.pauseChance) {
            totalTime += getRandomDelay(profile.pauseTime[0], profile.pauseTime[1]);
        }
    });
    
    return totalTime;
}

// Typing Animation Functions
function showTypingAnimation(phoneNumber, message) {
    $("#typingContainer").show();
    $("#currentNumber").text(phoneNumber);
    $("#typingText").html('<span class="typing-cursor">|</span>');
    $("#typingStatus").text("Думаю...");
    $("#typingStatus").addClass("typing-thinking typing-dots");
}

function hideTypingAnimation() {
    $("#typingContainer").hide();
    $("#typingStatus").removeClass("typing-thinking typing-dots typing-paused");
}

function startThinkingAnimation() {
    $("#typingStatus").text("Думаю").addClass("typing-thinking typing-dots");
}

function startTypingAnimation() {
    $("#typingStatus").text("Печатаю сообщение...").removeClass("typing-thinking typing-dots");
}

function updateCursorPosition() {
    const typingText = document.getElementById('typingText');
    const cursor = document.getElementById('typingCursor');
    
    if (typingText && cursor) {
        // Simply append cursor to the text content - much simpler and always accurate
        if (!typingText.innerHTML.includes('<span class="typing-cursor"')) {
            typingText.innerHTML = typingText.textContent + '<span class="typing-cursor" id="typingCursor">|</span>';
        }
    }
}

async function animateTypingWithPersonality(message, phoneNumber) {
    return new Promise(async (resolve) => {
        // Pick random typing personality for this message
        const personality = getRandomTypingPersonality();
        const profile = TYPING_PERSONALITIES[personality];
        
        console.log(`🎭 Using typing personality: ${profile.name} for ${phoneNumber}`);
        
        showTypingAnimation(phoneNumber, message);
        
        // Show personality in interface
        $("#typingStatus").text(`${profile.name} - Думаю`).addClass("typing-thinking typing-dots");
        
        // Thinking phase with personality-based timing
        const thinkingTime = simulateHumanPauses(personality);
        await new Promise(r => setTimeout(r, thinkingTime));
        
        if (stopSendingBulk || stopSendingIndividual) {
            hideTypingAnimation();
            resolve({ personality, typingTime: 0, thinkingTime });
            return;
        }
        
        // Start typing phase
        $("#typingStatus").text(`${profile.name} - Печатаю сообщение...`).removeClass("typing-thinking typing-dots");
        const typingTextElement = document.getElementById('typingText');
        let currentText = "";
        let actualTypingTime = 0;
        
        const words = message.split(' ');
        
        for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
            const word = words[wordIndex];
            
            // Type each character of the word with personality-based speed
            for (let charIndex = 0; charIndex < word.length; charIndex++) {
                if (stopSendingBulk || stopSendingIndividual) {
                    hideTypingAnimation();
                    resolve({ personality, typingTime: actualTypingTime, thinkingTime });
                    return;
                }
                
                currentText += word[charIndex];
                typingTextElement.innerHTML = currentText + '<span class="typing-cursor">|</span>';
                
                // Wait based on personality and word length
                const charDelay = getTypingSpeed(word, personality);
                actualTypingTime += charDelay;
                await new Promise(r => setTimeout(r, charDelay));
            }
            
            // Add space if not the last word
            if (wordIndex < words.length - 1) {
                currentText += ' ';
                typingTextElement.innerHTML = currentText + '<span class="typing-cursor">|</span>';
                
                // Space typing delay (balanced)
                const spaceDelay = getRandomDelay(20, 40);
                actualTypingTime += spaceDelay;
                await new Promise(r => setTimeout(r, spaceDelay));
                
                // Random pause between words based on personality
                if (Math.random() < profile.pauseChance) {
                    $("#typingStatus").text(`${profile.name} - Пауза...`).addClass("typing-paused");
                    const wordPause = getRandomDelay(profile.pauseTime[0], profile.pauseTime[1]);
                    actualTypingTime += wordPause;
                    await new Promise(r => setTimeout(r, wordPause));
                    $("#typingStatus").text(`${profile.name} - Печатаю сообщение...`).removeClass("typing-paused");
                }
            }
        }
        
        // Finished typing
        $("#typingStatus").text(`${profile.name} - Отправляю...`);
        await new Promise(r => setTimeout(r, 400)); // Small delay before hiding (balanced)
        
        hideTypingAnimation();
        resolve({ 
            personality, 
            typingTime: actualTypingTime, 
            thinkingTime,
            personalityName: profile.name 
        });
    });
}

// Legacy function for backward compatibility
async function animateTyping(message, phoneNumber) {
    const result = await animateTypingWithPersonality(message, phoneNumber);
    return result;
}

function getStorageInstance() {
    function setStorage(key, value) {
        return new Promise((resolve, reject) => {
            const obj = {};
            obj[key] = value;
            chrome.storage.local.set(obj, function () {
                resolve()
            })
        })
    }

    function getStorage(key) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(key, function (result) {
                resolve(result[key])
            })
        })
    }

    function savePhoneNumbersBulk(phoneNumbers) {
        return setStorage(KEY_PHONE_NUMBERS_BULK, JSON.stringify(phoneNumbers))
    }
    async function getPhoneNumbersBulk() {
        const strPhoneNumbers = await getStorage(KEY_PHONE_NUMBERS_BULK);
        if (strPhoneNumbers) {
            return JSON.parse(strPhoneNumbers)
        } else return []
    }

    // BULK MESSAGE
    function saveCurrentMessageBulk(currentMessage) {
        return setStorage(KEY_CURRENT_MSG_BULK, currentMessage)
    }

    function getCurrentMessageBulk() {
        return getStorage(KEY_CURRENT_MSG_BULK)
    }

    // INDIVIDUAL MESSAGE
    function savePhoneNumbersIndividual(phoneNumbers) {
        console.log('phoneNumbers::', phoneNumbers);
        return setStorage(KEY_PHONE_NUMBERS_INDIVIDUAL, JSON.stringify(phoneNumbers))
    }
    async function getPhoneNumbersIndividual() {
        const strPhoneNumbers = await getStorage(KEY_PHONE_NUMBERS_INDIVIDUAL);
        if (strPhoneNumbers) {
            return JSON.parse(strPhoneNumbers)
        } else return []
    }

    function saveCurrentMessageIndividual(currentMessage) {
        return setStorage(KEY_CURRENT_MSG_INDIVIDUAL, currentMessage)
    }

    function getCurrentMessageIndividual() {
        return getStorage(KEY_CURRENT_MSG_INDIVIDUAL)
    }


    function savePhoneNumber(phoneNumber) {
        return setStorage(KEY_PHONE_NUMBER, phoneNumber)
    }
    async function getPhoneNumber() {
        const strPhoneNumber = await getStorage(KEY_PHONE_NUMBER);
        // console.log('getPhoneNumber: strPhoneNumber:', strPhoneNumber, KEY_PHONE_NUMBER);
        return strPhoneNumber
    }

    function saveCurrentMessage(currentMessage) {
        return setStorage(KEY_CURRENT_MSG, currentMessage)
    }

    function getCurrentMessage() {
        return getStorage(KEY_CURRENT_MSG)
    }

    return {
        // BULK MESSAGE
        getCurrentMessageBulk: getCurrentMessageBulk,
        saveCurrentMessageBulk: saveCurrentMessageBulk,
        getPhoneNumbersBulk: getPhoneNumbersBulk,
        savePhoneNumbersBulk: savePhoneNumbersBulk,
        // INDIVIDUAL MESSAGE
        getCurrentMessageIndividual: getCurrentMessageIndividual,
        saveCurrentMessageIndividual: saveCurrentMessageIndividual,
        getPhoneNumbersIndividual: getPhoneNumbersIndividual,
        savePhoneNumbersIndividual: savePhoneNumbersIndividual,

        // GET ACTIVE TAB
        getActiveTab: getActiveTab,

        // SAVE & GET MESSAGE-NUMBER
        saveCurrentMessage: saveCurrentMessage,
        savePhoneNumber: savePhoneNumber,
        getCurrentMessage: getCurrentMessage,
        getPhoneNumber: getPhoneNumber,
    }
}

function getActiveTab() {
    return new Promise(resolve => {
        chrome.tabs.query({
            active: true,
            currentWindow: true
        }, function (tabs) {
            resolve(tabs[0].id)
        })
    })
}

async function ensureContentScriptLoaded(tabId) {
    try {
        console.log(`🔍 Checking if content script is loaded on tab ${tabId}`);
        // Try to ping the content script
        const response = await new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, {subject: "PING"}, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        });
        console.log(`✅ Content script already loaded:`, response);
        return true;
    } catch (error) {
        console.log(`❌ Content script not loaded, injecting it...`, error.message);
        
        // Inject the content script programmatically
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
            });
            console.log(`✅ Content script injected successfully`);
            
            // Wait a moment for it to initialize
            await new Promise(resolve => setTimeout(resolve, 1000));
            return true;
        } catch (injectError) {
            console.error(`❌ Failed to inject content script:`, injectError);
            return false;
        }
    }
}

function sendMsgToActiveTab(msg) {
    return new Promise((resolve, reject) => {
        getActiveTab().then(async tabid => {
            console.log(`📤 Sending message to tab ${tabid}:`, msg);
            
            // Ensure content script is loaded first
            const isLoaded = await ensureContentScriptLoaded(tabid);
            if (!isLoaded) {
                reject(new Error('Failed to load content script'));
                return;
            }
            
            chrome.tabs.sendMessage(tabid, msg, (response) => {
                if (chrome.runtime.lastError) {
                    console.error(`❌ Chrome runtime error:`, chrome.runtime.lastError);
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    console.log(`📨 Received response:`, response);
                    resolve(response);
                }
            });
        }).catch(error => {
            console.error(`❌ Error getting active tab:`, error);
            reject(error);
        });
    })
}

function sendMsgToExtension(msg) {
    chrome.runtime.sendMessage(msg)
}

let isPageWebWhatsapp = false;
const storageInstance = getStorageInstance();
let authid = "";
let authPhoneNumber = "";
let msgBulk = "";
let msgIndividual = "";
let delay = 1 * 1 * 1e3;
let phoneNumbersBulk = [];
let phoneNumberSendToBulk = [];
let phoneNumberIndividual = [];
let phoneNumbersBulkMessage = [];
let contacts = [];

let msg = "";
let phoneNumber = "";

// Mistral AI API configuration
const MISTRAL_API_KEY = "QqkMxELY0YVGkCx17Vya04Sq9nGvCahu"; // Replace with your API key
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

async function generateVariedMessage(originalMessage, maxLength = 160) {
    try {
        const response = await fetch(MISTRAL_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${MISTRAL_API_KEY}`
            },
            body: JSON.stringify({
                model: "open-mistral-nemo",
                messages: [{
                    role: "user",
                    content: `Перефразируй это сообщение на русском языке полностью, используя другие слова, но сохраняя тот же смысл и тон. Сделай его естественным и разговорным. Обязательно закончи сообщение полностью. Не включай количество символов или другую мета-информацию. Просто верни готовое перефразированное сообщение на русском языке: "${originalMessage}"`
                }],
                max_tokens: 500,
                temperature: 0.8
            })
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        let rephrased = data.choices[0].message.content.trim();
        
        // Remove any character count information or quotes
        rephrased = rephrased.replace(/\(\d+\s*characters?\)/gi, '');
        rephrased = rephrased.replace(/^["']|["']$/g, ''); // Remove surrounding quotes
        rephrased = rephrased.trim();
        
        return rephrased;
    } catch (error) {
        console.error('Mistral API error:', error);
        return originalMessage; // Return original if API fails
    }
}

async function generateMultipleVariations(originalMessage, count = 3, maxLength = 100) {
    const variations = [];
    for (let i = 0; i < count; i++) {
        const variation = await generateVariedMessage(originalMessage, maxLength);
        variations.push(variation);
        // Small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    return variations;
}

// Progress tracking functions
function showProgress(current, total) {
    $("#progressContainer").show();
    const percentage = Math.round((current / total) * 100);
    $("#sendingProgress").css("width", percentage + "%").attr("aria-valuenow", percentage);
    $("#progressText").text(`Отправка: ${current} из ${total}`);
    
    // Change button text and disable it
    $("#sendMessageBulk").text("Отправка...").prop("disabled", true);
}

function hideProgress() {
    $("#progressContainer").hide();
    $("#sendMessageBulk").text("Отправить").prop("disabled", false);
}

function updateProgress(current, total, currentNumber = "") {
    const percentage = Math.round((current / total) * 100);
    $("#sendingProgress").css("width", percentage + "%").attr("aria-valuenow", percentage);
    $("#progressText").text(`Отправка: ${current} из ${total}${currentNumber ? ` (${currentNumber})` : ""}`);
}

window.addEventListener("DOMContentLoaded", async function () {
    initApp();
    sendMsgToActiveTab({
        from: "popup.js",
        subject: MSG_GET_PAGE_URL,
        data: ""
    }).then(url => {
        if (url === "https://web.whatsapp.com" || url === "https://web.whatsapp.com/") {
            isPageWebWhatsapp = true
        }
        updateView()
    });
    sendMsgToActiveTab({
        from: "popup.js",
        subject: MSG_GET_USER_PHONENUMBER,
        data: ""
    }).then(phoneNumber => {
        authPhoneNumber = phoneNumber;
        updateView()
    })
});
async function initApp() {
    await initBulkMessageTab();
    await initIndividualMessageTab();
    updateView();
    addEventListeners();

}

async function initSingleMessageTab() {
    phoneNumber = await storageInstance.getPhoneNumber();
    msg = await storageInstance.getCurrentMessage();
}

async function initBulkMessageTab() {
    phoneNumbersBulk = await storageInstance.getPhoneNumbersBulk();
    msgBulk = await storageInstance.getCurrentMessageBulk();
}

async function initIndividualMessageTab() {
    phoneNumberIndividual = await storageInstance.getPhoneNumbersIndividual();
    msgIndividual = await storageInstance.getCurrentMessageIndividual();
}

function updateView() {
    updateBulkMessageView();
    updateIndividualMessageView();
}

function updateBulkMessageView() {
    $("#inputMessageBulk").val(msgBulk);
    let strInputNumberBulk = "";
    if (phoneNumbersBulk && phoneNumbersBulk.length > 0) {
        strInputNumberBulk = phoneNumbersBulk.reduce((acc, phonenumber, index) => {
            return acc = acc + "\n" + phonenumber
        })
    }
    $("#inputNumbersBulk").val(strInputNumberBulk);
    // Check the actual data that will be used for sending
    if (!phoneNumberSendToBulk || phoneNumberSendToBulk.length === 0) {
        $("#sendMessageBulk").prop("disabled", true);
        console.log("📵 Send button disabled - no valid phone numbers in phoneNumberSendToBulk");
    } else if (!msgBulk || msgBulk.trim().length === 0) {
        $("#sendMessageBulk").prop("disabled", true);
        console.log("📵 Send button disabled - no message text");
    } else {
        $("#sendMessageBulk").prop("disabled", false);
        console.log(`✅ Send button enabled - ${phoneNumberSendToBulk.length} phone numbers and message ready`);
    }
}

// INDIVIDUAL MESSAGE
function updateIndividualMessageView() {
    $("#inputIndividualMessage").val(msgIndividual);
    let strInputNumberIndividual = "";
    if (phoneNumberIndividual && phoneNumberIndividual.length > 0) {
        strInputNumberIndividual = phoneNumberIndividual.reduce((acc, phonenumber, index) => {
            return acc = acc + "\n" + phonenumber
        })
    }
    $("#individualMessageTabPhoneNumber").val(strInputNumberIndividual);
    
    // Better validation logic
    const hasValidNumbers = phoneNumberIndividual && phoneNumberIndividual.length > 0 && 
                           phoneNumberIndividual.some(num => num && num.trim().replace(/\D/g, '').length >= 7);
    const hasValidMessage = msgIndividual && msgIndividual.trim().length > 0;
    
    if (!hasValidNumbers) {
        $("#sendMessageIndividual").prop("disabled", true);
        console.log("📵 Individual send button disabled - no valid phone numbers");
    } else if (!hasValidMessage) {
        $("#sendMessageIndividual").prop("disabled", true);
        console.log("📵 Individual send button disabled - no message text");
    } else {
        $("#sendMessageIndividual").prop("disabled", false);
        console.log(`✅ Individual send button enabled - ${phoneNumberIndividual.length} phone numbers and message ready`);
    }
}

/* *****************************-------SEND BULK MESSAGE--------******************************** */

async function sendToBulkOneByOne(data, msgBulk, baseDelay, useVariations = false) {
    console.log(`🚀 Starting one-by-one send for ${data.length} messages`);
    console.log(`💡 Tip: Use "🔍 Проверить номера" button to remove recently contacted numbers before sending`);
    
    stopSendingBulk = false;
    showProgress(0, data.length);
    
    // Show stop button and hide send button
    $("#sendMessageBulk").hide();
    $("#stopSending").show();

    // Set up progress listener for real-time updates (disabled to prevent conflicts)
    const progressListener = (message) => {
        if (message.subject === "PROGRESS_UPDATE") {
            console.log(`📊 Progress update from content script:`, message.data);
            // Disabled: updateProgress(message.data.current, message.data.total, message.data.number);
            // We handle progress locally to avoid conflicts
        }
    };
    
    // Listen for progress updates from content script
    chrome.runtime.onMessage.addListener(progressListener);

    try {
        // Process each message one by one: generate → send → generate → send
        for (let i = 0; i < data.length; i++) {
            // Check if user pressed stop
            if (stopSendingBulk) {
                console.log(`🛑 Stopping bulk send at message ${i + 1}/${data.length}`);
                break;
            }

            console.log(`📝 Processing message ${i + 1}/${data.length} for ${data[i].number}`);
            
            // Generate message for this specific recipient
            let newMessage = msgBulk.replace(/@valueOne/g, data[i].valueOne);
            newMessage = newMessage.replace(/@valueTwo/g, data[i].valueTwo);

            // Generate AI variation if enabled
            if (useVariations && MISTRAL_API_KEY !== "your-mistral-api-key-here") {
                try {
                    console.log(`🤖 Generating AI variation for ${data[i].number}...`);
                    newMessage = await generateVariedMessage(newMessage, 160);
                    console.log(`✨ Generated variation for ${data[i].number}: "${newMessage}"`);
                } catch (error) {
                    console.log(`⚠️ Using original message for ${data[i].number} due to variation error:`, error);
                }
            }

            // Check if user pressed stop before sending
            if (stopSendingBulk) {
                console.log(`🛑 Stopping bulk send before sending to ${data[i].number}`);
                break;
            }

            // Update progress before sending (show current message being processed)
            updateProgress(i + 1, data.length, data[i].number);

            // Send this single message with visual typing animation
            try {
                console.log(`📤 Sending message to ${data[i].number} with visual typing animation`);
                
                // Show typing animation that matches the actual timing
                const personalityInfo = await animateTypingWithPersonality(newMessage, data[i].number);
                
                // Check if user pressed stop during animation
                if (stopSendingBulk) {
                    console.log(`🛑 Stopping bulk send during typing animation`);
                    break;
                }
                
                const response = await sendMsgToActiveTab({
                    from: "home.js",
                    subject: MSG_SEND_MESSAGE,
                    data: {
                        messages: [{
                            number: data[i].number,
                            message: newMessage
                        }],
                        delay: baseDelay,
                        humanTyping: {
                            enabled: true,
                            personality: personalityInfo.personality,
                            typingTime: personalityInfo.typingTime,
                            thinkingTime: personalityInfo.thinkingTime,
                            animated: true // Flag to indicate animation was shown
                        }
                    }
                });

                console.log(`✅ Message sent to ${data[i].number}:`, response);
                
                // Add to message history after successful send
                await addToMessageHistory(data[i].number, newMessage);

            } catch (error) {
                console.error(`❌ Error sending to ${data[i].number}:`, error);
                hideTypingAnimation(); // Hide animation on error
            }

            // Wait before next message (except for the last one) but check for stop during wait
            if (i < data.length - 1 && !stopSendingBulk) {
                // Add random delay between messages (balanced)
                const randomDelay = getRandomDelay(1500, 3500);
                console.log(`⏰ Waiting ${randomDelay}ms before next message (balanced delay)...`);
                
                // Break the delay into smaller chunks to check for stop more frequently
                const checkInterval = 500; // Check every 500ms
                const chunks = Math.ceil(randomDelay / checkInterval);
                
                for (let chunk = 0; chunk < chunks; chunk++) {
                    if (stopSendingBulk) break;
                    const waitTime = Math.min(checkInterval, randomDelay - (chunk * checkInterval));
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }

        if (stopSendingBulk) {
            console.log(`🛑 Bulk sending stopped by user`);
        } else {
            console.log(`🎉 All ${data.length} messages processed!`);
        }
        
    } catch (error) {
        console.error(`❌ Error in one-by-one send:`, error);
    } finally {
        // Remove progress listener
        chrome.runtime.onMessage.removeListener(progressListener);
        
        // Reset UI
        $("#stopSending").hide();
        $("#sendMessageBulk").show();
        stopSendingBulk = false;
        
        // Final cleanup
        setTimeout(() => {
            hideProgress();
            updateView();
        }, 1000);
    }
}

function addEventListenersBulkMessageView() {
    $("#sendMessageBulk").click(async function () {
        if (phoneNumberSendToBulk.length > 0) {
            const baseDelay = 5000;
            const useVariations = $("#useMessageVariations").is(":checked");
            sendToBulkOneByOne(phoneNumberSendToBulk, msgBulk, baseDelay, useVariations);
        }
    });

    $("#stopSending").click(function () {
        console.log("🛑 User clicked stop button for bulk sending");
        stopSendingBulk = true;
        $(this).prop("disabled", true).text("Остановка...");
    });
    $("#inputMessageBulk").on("input", async function () {
        msgBulk = $(this).val();
        await storageInstance.saveCurrentMessageBulk(msgBulk);
        updateView();
    });
    $("#inputNumbersBulk").on("input change paste", async function () {
        const rawInput = this.value;
        console.log(`📝 Processing phone number input: "${rawInput}"`);
        
        phoneNumbersBulk = rawInput.split("\n");
        phoneNumberSendToBulk = [];

        for (i = 0; i < phoneNumbersBulk.length; i++) {
            const line = phoneNumbersBulk[i].trim();
            if (!line) continue; // Skip empty lines
            
            const splitedValue = line.split(",");
            const phoneNumber = splitedValue[0] ? splitedValue[0].trim().replace('+', '') : '';
            
            // Only add if phone number is not empty and looks valid (at least 7 digits)
            if (phoneNumber && phoneNumber.replace(/\D/g, '').length >= 7) {
                const data = {
                    number: phoneNumber,
                    valueOne: splitedValue[1] ? splitedValue[1].trim() : '',
                    valueTwo: splitedValue[2] ? splitedValue[2].trim() : ''
                }
                phoneNumberSendToBulk.push(data);
                console.log(`✅ Added valid number: ${phoneNumber}`);
            } else {
                console.log(`❌ Skipped invalid number: "${line}"`);
            }
        }
        
        console.log(`📊 Total valid numbers: ${phoneNumberSendToBulk.length}`);
        await storageInstance.savePhoneNumbersBulk(phoneNumbersBulk);
        updateView();
    });
    $("#btnUploadNumbersButton").click(function () {
        document.getElementById("inputUploadNumbers").click();
        updateView();
    });
    
    $("#btnCheckRecentNumbers").click(async function () {
        await checkAndRemoveRecentNumbers();
    });
    $("#inputUploadNumbers").on("change", function () {
        const file = $(this)[0].files[0];
        var fr = new FileReader;
        fr.onload = async function (event) {
            phoneNumbersBulk = event.target.result.split("\n").filter(token => token.trim().length > 9);
            const csvData = event.target.result.split("\n");
            phoneNumberSendToBulk = [];

            for (i = 0; i < csvData.length; i++) {
                const splitedValue = csvData[i].split(",");
                if (splitedValue[0]) {
                    const data = {
                        number: splitedValue[0] ? splitedValue[0].replace('+', '') : '',
                        valueOne: splitedValue[1] ? splitedValue[1] : '',
                        valueTwo: splitedValue[2] ? splitedValue[2] : ''
                    }
                    phoneNumberSendToBulk.push(data);
                }
            }
            await storageInstance.savePhoneNumbersBulk(phoneNumbersBulk);
            updateView();
        };
        fr.readAsText(file);
    });
}

/* *****************************-------SEND INDIVIDUAL MESSAGE--------******************************** */

async function sendMessageToIndividual(index, data, msgIndividual, delay) {
    console.log(`🚀 Starting individual message send`);
    const phoneNumber = data[index];
    
    stopSendingIndividual = false;
    
    // Show stop button and hide send button
    $("#sendMessageIndividual").hide();
    $("#stopSendingIndividual").show();

    try {
        // Check if user pressed stop
        if (stopSendingIndividual) {
            console.log(`🛑 Individual sending stopped by user`);
            return;
        }

        console.log(`📤 Sending individual message to ${data[index]} with visual typing animation`);
        
        // Show typing animation that matches the actual timing
        await animateTyping(msgIndividual, data[index]);
        
        // Check if user pressed stop during animation
        if (stopSendingIndividual) {
            console.log(`🛑 Individual sending stopped during typing animation`);
            return;
        }
        
        // Calculate realistic typing time for backend
        const typingTime = calculateMessageTypingTime(msgIndividual);
        console.log(`⌨️  Backend typing time: ${typingTime}ms for message: "${msgIndividual.substring(0, 50)}..."`);
        
        await sendMsgToActiveTab({
            from: "home.js",
            subject: MSG_SEND_MESSAGE,
            data: {
                message: msgIndividual,
                numbers: [data[index]],
                delay: delay,
                humanTyping: {
                    enabled: true,
                    typingTime: typingTime,
                    animated: true // Flag to indicate animation was shown
                }
            }
        });
        
        console.log(`✅ Individual message sent successfully`);
        
        // Add to message history after successful send
        await addToMessageHistory(phoneNumber, msgIndividual);
        
    } catch (error) {
        console.error(`❌ Error sending individual message:`, error);
        hideTypingAnimation(); // Hide animation on error
    } finally {
        // Reset UI
        $("#stopSendingIndividual").hide();
        $("#sendMessageIndividual").show();
        stopSendingIndividual = false;
    }
}

function addEventListenersIndividualMessageView() {

    $("#sendMessageIndividual").click(async function () {
        if (phoneNumberIndividual.length > 0) {
            await sendMessageToIndividual(0, phoneNumberIndividual, msgIndividual, delay);
        }
    });

    $("#stopSendingIndividual").click(function () {
        console.log("🛑 User clicked stop button for individual sending");
        stopSendingIndividual = true;
        $(this).prop("disabled", true).text("Остановка...");
    });
    $("#inputIndividualMessage").on("input", async function () {
        msgIndividual = $(this).val();
        await storageInstance.saveCurrentMessageIndividual(msgIndividual);
        updateView();
    });
    $("#individualMessageTabPhoneNumber").on("input change paste", async function () {
        const rawInput = this.value.trim();
        console.log(`📝 Processing individual phone number input: "${rawInput}"`);
        
        if (!rawInput) {
            phoneNumberIndividual = [];
        } else {
            phoneNumberIndividual = rawInput.split("\n");
            // Clean and validate the phone number
            phoneNumberIndividual[0] = phoneNumberIndividual[0] ? phoneNumberIndividual[0].trim().replace('+', '') : '';
            
            // Remove empty entries
            phoneNumberIndividual = phoneNumberIndividual.filter(num => num && num.trim().length >= 7);
        }
        
        console.log(`📊 Individual phone numbers processed:`, phoneNumberIndividual);
        await storageInstance.savePhoneNumbersIndividual(phoneNumberIndividual);
        updateView();
    });

    $("#valueOneLabel").click(function (evt) {
        var messageValue = document.getElementById("inputMessageBulk");
        var startPosition = messageValue.selectionStart;
        var endPosition = messageValue.selectionEnd;
        textWithValueOne = '@valueOne';
        var fullString = messageValue.value.substring(0, startPosition) +
            textWithValueOne +
            messageValue.value.substring(endPosition, messageValue.value.length);
        document.getElementById("inputMessageBulk").value = fullString;
        msgBulk = $('#inputMessageBulk').val();
        document.getElementById("valueOneLabel").blur();
        evt.preventDefault();
        var input = $("#inputMessageBulk");
        var len = input.val().length;
        input[0].focus();
        input[0].setSelectionRange(len, len);
    });

    $("#valueTwoLabel").click(function (evt) {
        var messageValue = document.getElementById("inputMessageBulk");
        var startPosition = messageValue.selectionStart;
        var endPosition = messageValue.selectionEnd;
        var textWithValueTwo = '@valueTwo';
        var fullString = messageValue.value.substring(0, startPosition) +
            textWithValueTwo +
            messageValue.value.substring(endPosition, messageValue.value.length);
        document.getElementById("inputMessageBulk").value = fullString;
        msgBulk = $('#inputMessageBulk').val();
        document.getElementById("valueTwoLabel").blur();
        evt.preventDefault();
        var input = $("#inputMessageBulk");
        var len = input.val().length;
        input[0].focus();
        input[0].setSelectionRange(len, len);
    });
}

function addEventListenersClearAllFields() {

    $("#clearAllFieldsIndividual").click(async function () {
        document.getElementById("individualMessageTabPhoneNumber").value = '';
        document.getElementById("inputIndividualMessage").value = '';
        phoneNumberIndividual = '';
        msgIndividual = '';
        await storageInstance.savePhoneNumbersIndividual(phoneNumberIndividual);
        await storageInstance.saveCurrentMessageIndividual(msgIndividual);
        delay = '';
    });

    $("#clearAllFieldsBulk").click(async function () {
        document.getElementById("inputNumbersBulk").value = '';
        document.getElementById("inputMessageBulk").value = '';
        document.getElementById("inputUploadNumbers").value = '';
        phoneNumbersBulk = '';
        msgBulk = '';
        await storageInstance.savePhoneNumbersBulk(phoneNumbersBulk);
        await storageInstance.saveCurrentMessageBulk(msgBulk);
        delay = '';
    });
}

function addEventListeners() {
    addEventListenersBulkMessageView();
    addEventListenersIndividualMessageView();
    addEventListenersClearAllFields();
    addTabAnimationListeners();
}

// Enhanced Tab Animation System
function addTabAnimationListeners() {
    // Add click animation feedback
    $('[data-toggle="tab"]').on('click', function() {
        // Add subtle tab click animation
        $(this).addClass('tab-clicked');
        setTimeout(() => {
            $(this).removeClass('tab-clicked');
        }, 300);
        
        // Log tab switching
        const targetTab = $(this).attr('href').substring(1);
        console.log(`🎭 Tab clicked: ${targetTab}`);
    });
    
    // Let Bootstrap handle the tab switching while we add visual enhancements
    // The CSS animations will automatically apply when Bootstrap changes the active class
}

// Add CSS for tab click animation
const tabClickCSS = `
.nav-link.tab-clicked {
    transform: translateY(-3px) scale(1.1) !important;
    box-shadow: 0 15px 50px rgba(55, 114, 255, 0.6) !important;
    animation: tabPulse 0.3s ease-out !important;
}

@keyframes tabPulse {
    0% { transform: translateY(-3px) scale(1.05); }
    50% { transform: translateY(-5px) scale(1.12); }
    100% { transform: translateY(-3px) scale(1.1); }
}

.tab-pane.slide-out-right {
    transform: translateX(100%);
    opacity: 0;
}
`;

// Inject the CSS
if (!document.getElementById('tab-animation-styles')) {
    const style = document.createElement('style');
    style.id = 'tab-animation-styles';
    style.textContent = tabClickCSS;
    document.head.appendChild(style);
}