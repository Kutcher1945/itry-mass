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
    if (phoneNumbersBulk.length === 0) {
        $("#sendMessageBulk").prop("disabled", true)
    } else if (!msgBulk || msgBulk.trim().length === 0) {
        $("#sendMessageBulk").prop("disabled", true)
    } else {
        $("#sendMessageBulk").prop("disabled", false)
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
    if (phoneNumberIndividual.length === 0) {
        $("#sendMessageIndividual").prop("disabled", true)
    } else if (!msgIndividual || msgIndividual.trim().length === 0) {
        $("#sendMessageIndividual").prop("disabled", true)
    } else {
        $("#sendMessageIndividual").prop("disabled", false)
    }
}

/* *****************************-------SEND BULK MESSAGE--------******************************** */

async function sendToBulkOneByOne(data, msgBulk, baseDelay, useVariations = false) {
    console.log(`🚀 Starting one-by-one send for ${data.length} messages`);
    showProgress(0, data.length);

    // Set up progress listener for real-time updates
    const progressListener = (message) => {
        if (message.subject === "PROGRESS_UPDATE") {
            console.log(`📊 Progress update:`, message.data);
            updateProgress(message.data.current, message.data.total, message.data.number);
        }
    };
    
    // Listen for progress updates from content script
    chrome.runtime.onMessage.addListener(progressListener);

    try {
        // Process each message one by one: generate → send → generate → send
        for (let i = 0; i < data.length; i++) {
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

            // Update progress
            updateProgress(i, data.length, data[i].number);

            // Send this single message immediately
            try {
                console.log(`📤 Sending message to ${data[i].number}`);
                const response = await sendMsgToActiveTab({
                    from: "home.js",
                    subject: MSG_SEND_MESSAGE,
                    data: {
                        messages: [{
                            number: data[i].number,
                            message: newMessage
                        }],
                        delay: baseDelay
                    }
                });

                console.log(`✅ Message sent to ${data[i].number}:`, response);
                
                // Update progress after sending
                updateProgress(i + 1, data.length, data[i].number);

            } catch (error) {
                console.error(`❌ Error sending to ${data[i].number}:`, error);
            }

            // Wait before next message (except for the last one)
            if (i < data.length - 1) {
                console.log(`⏰ Waiting ${baseDelay}ms before next message...`);
                await new Promise(resolve => setTimeout(resolve, baseDelay));
            }
        }

        console.log(`🎉 All ${data.length} messages processed!`);
        
    } catch (error) {
        console.error(`❌ Error in one-by-one send:`, error);
    } finally {
        // Remove progress listener
        chrome.runtime.onMessage.removeListener(progressListener);
        
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
    $("#inputMessageBulk").on("input", async function () {
        msgBulk = $(this).val();
        await storageInstance.saveCurrentMessageBulk(msgBulk);
        updateView();
    });
    $("#inputNumbersBulk").on("change", async function () {
        phoneNumbersBulk = this.value.split("\n");
        phoneNumberSendToBulk = [];

        for (i = 0; i < phoneNumbersBulk.length; i++) {
            const splitedValue = phoneNumbersBulk[i].split(",");
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
    });
    $("#btnUploadNumbersButton").click(function () {
        document.getElementById("inputUploadNumbers").click();
        updateView();
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

function sendMessageToIndividual(index, data, msgIndividual, delay) {

    sendMsgToActiveTab({
        from: "home.js",
        subject: MSG_SEND_MESSAGE,
        data: {
            message: msgIndividual,
            numbers: [data[index]],
            delay: delay
        }
    });
}

function addEventListenersIndividualMessageView() {

    $("#sendMessageIndividual").click(async function () {
        if (phoneNumberIndividual.length > 0) {
            sendMessageToIndividual(0, phoneNumberIndividual, msgIndividual, delay);
        }
    });
    $("#inputIndividualMessage").on("input", async function () {
        msgIndividual = $(this).val();
        await storageInstance.saveCurrentMessageIndividual(msgIndividual);
        updateView();
    });
    $("#individualMessageTabPhoneNumber").on("change", async function () {
        phoneNumberIndividual = this.value.split("\n");
        phoneNumberIndividual[0] = phoneNumberIndividual[0] ? phoneNumberIndividual[0].replace('+', '') : '';
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
}