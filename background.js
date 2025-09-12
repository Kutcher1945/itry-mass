// Constants for message passing
const MSG_GET_REF_COOKIE = 'MSG_GET_REF_COOKIE';
const MSG_REF_COOKIE_VALUE = 'MSG_REF_COOKIE_VALUE';
const MSG_SHOW_WHATSAPP_TAB = 'MSG_SHOW_WHATSAPP_TAB';

chrome.runtime.onInstalled.addListener(async function(details) {
    await showWhatsappTab();
    var notifOptions = {
        type: "basic",
        iconUrl: "images/48.png",
        title: "iTry Message Sender Installation Finished.",
        message: "Click on the extension icon to open side panel"
    };
    chrome.notifications.create(notifOptions, function(notificationID) {
        console.log(notificationID, "notif created", chrome.runtime.lastError)
    })
});
chrome.runtime.onMessage.addListener(async function(msg, sender) {
    console.log('onMessage');
    if (msg.subject === MSG_GET_REF_COOKIE) {
        const refid = await getRefCookie();
        sendMsgToExtension({
            from: "background.js",
            subject: MSG_REF_COOKIE_VALUE,
            data: refid
        })
    }
    if (msg.subject === MSG_SHOW_WHATSAPP_TAB) {
        showWhatsappTab(false)
    }
});

// Helper functions
function sendMsgToExtension(message) {
    chrome.runtime.sendMessage(message);
}

async function getRefCookie() {
    // Placeholder function for cookie handling
    return 'default_ref_id';
}
async function showWhatsappTab(reload = true) {
    console.log('showWhatsappTab');
    console.log('chrome.tabs:', chrome.tabs);
    chrome.tabs.getAllInWindow(null, function(tabs) {
        console.log('Tabs:', tabs);
        const whatsappTab = tabs.find(tab => tab.url === "https://web.whatsapp.com" || tab.url === "https://web.whatsapp.com/");
        console.log('whatsappTab', whatsappTab);
        if (whatsappTab) {
            chrome.tabs.update(whatsappTab.id, {
                active: true
            }, function(tab) {
                console.log("Error this")
            });
            if (reload) {
                setTimeout(function() {
                    chrome.tabs.reload(whatsappTab.id)
                }, 500)
            }
        } else {
            const newURL = "https://web.whatsapp.com";
            chrome.tabs.create({
                url: newURL
            })
        }
    })
}

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  console.log('Extension icon clicked, opening side panel');
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
    // Automatically open WhatsApp Web when side panel opens
    await showWhatsappTab(false);
  } catch (error) {
    console.error('Error opening side panel:', error);
  }
});