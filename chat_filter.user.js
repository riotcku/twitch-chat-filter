// ==UserScript==
// @name        Twitch Plays Pokemon Chat Filter
// @namespace   https://github.com/jpgohlke/twitch-chat-filter
// @description Hide input commands from the chat.
// @include     http://www.twitch.tv/twitchplayspokemon
// @include     http://www.twitch.tv/twitchplayspokemon/
// @version     1.3
// @updateURL   https://raw.github.com/jpgohlke/twitch-chat-filter/master/chat_filter.user.js
// @grant       unsafeWindow
// ==/UserScript==

/*
 * Permission is hereby granted, free of charge, to any person obtaining a copy 
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights 
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell 
 * copies of the Software, and to permit persons to whom the Software is furnished 
 * to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in all 
 * copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A 
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT 
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION 
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE 
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/* 
 * chat_filter.user.js
 *
 * Feel free to review/compress it yourself; good internet security is important!
 * Passes http://www.jshint.com on default settings
 * Contributors:
 *     /u/RenaKunisaki
 *     /u/smog_alado 
 *     /u/SRS-SRSLY
 *     /u/schrobby
 *     /u/red_agent
 *     /u/DeathlyDeep
 *     /u/jeff_gohlke
 *     /u/yankjenets
 *     /u/hugomg
 *     /u/MKody
 *     /u/feha
 *     /u/jakery2
 *     /u/redopium
 */

/* global unsafeWindow:false */
/* jshint lastsemic:true */


(function(){
"use strict";

// --- Script configuration ---

var TPP_COMMANDS = [
    "left", "right", "up", "down",
    "start", "select",
    "a", "b",
    "democracy", "anarchy", "wait"
];

// Score-based filter for "Guys, we need to beat Misty" spam.
var MISTY_SUBSTRINGS = [
    "misty",
    "guys",
    "we have to",
    "we need to",
    "beat"
];

var URL_WHITELIST = [
    //us
     "github.com",
    //reddit
    "reddit.com",
    "webchat.freenode.net/?channels=twitchplayspokemon",
    "sites.google.com/site/twitchplayspokemonstatus/",
    "www.reddit.com/live/sw7bubeycai6hey4ciytwamw3a",
    //miscelaneous
    "strawpoll.me",
    "imgur.com",
    "pokeworld.herokuapp.com"
];

var MINIMUM_DISTANCE_ERROR = 2; // Number of insertions / deletions / substitutions away from a blocked word.
var MAXIMUM_NON_ASCII_CHARACTERS = 2; // For donger smilies, etc
var MINIMUM_MESSAGE_WORDS = 2; // For Kappas and other short messages.

// --- Greasemonkey loading ---

//Greasemonkey userscripts run in a separate environment and cannot use
//global variables from the page directly. We needd to access them via unsafeWindow
var myWindow;
try{
    myWindow = unsafeWindow;
}catch(e){
    myWindow = window;
}

var $ = myWindow.jQuery;
var CurrentChat = null;
    
// --- Filtering predicates ---

// Adapted from https://gist.github.com/andrei-m/982927
// Compute the edit distance between the two given strings
function min_edit(a, b) {
    
    if(a.length === 0) return b.length; 
    if(b.length === 0) return a.length; 
 
    var matrix = [];
 
    // increment along the first column of each row
    for(var i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
 
    // increment each column in the first row
    for(var j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
 
    // Fill in the rest of the matrix
    for(var i = 1; i <= b.length; i++) {
        for(var j = 1; j <= a.length; j++) {
            if(b.charAt(i-1) == a.charAt(j-1)){
                matrix[i][j] = matrix[i-1][j-1];
            } else {
                matrix[i][j] = 1 + Math.min(
                    matrix[i-1][j-1], // substitution
                    matrix[i][j-1]  , // insertion
                    matrix[i-1][j]    // deletion
                ); 
            }
        }
    }
 
    return matrix[b.length][a.length];
}

//This regex recognizes messages that contain exactly a chat command,
//without any extra words around. This includes compound democracy mode
//commands like `up2left4` and `start9`.
// (remember to escape the backslashes when building a regexes from strings!)
var compound_command_regex = new RegExp("^((" + TPP_COMMANDS.join("|") + ")\\d*)+$", "i");

function word_is_command(word){

    if(compound_command_regex.test(word)) return true;

    for(var j=0; j<TPP_COMMANDS.length; j++){
        var cmd = TPP_COMMANDS[j];
          
        if(min_edit(cmd, word) <= MINIMUM_DISTANCE_ERROR){
           return true;
        }
    }
    return false;   
}

function message_is_command(message){
    message = message.toLowerCase();
    
    var segments = message.split(/[\d\s]+/);
    
    for(var i=0; i<segments.length; i++){
        var segment = segments[i];
        if(!segment) continue;
        if(!word_is_command(segment)) return false;
    }
    
    return true;
}

// Determine if message is variant of "Guys, we need to beat Misty."
function message_is_misty(message) {
    message = message.toLowerCase();
    
    var misty_score = 0;
    for (var i = 0; i < MISTY_SUBSTRINGS.length; i++) {
        if (message.indexOf(MISTY_SUBSTRINGS[i]) != -1) {
            misty_score++;
            if (misty_score > 1) {    
                return true;
            }
        }
    }
    
    return false;
}

function is_whitelisted_url(url){
    //This doesnt actually parse the URLs but it
    //should do the job when it comes to filtering.
    for(var i=0; i<URL_WHITELIST.length; i++){
        if(0 <= url.indexOf(URL_WHITELIST[i])){
            return true;
        }
    }
    return false;
}

function message_is_forbidden_link(message){
    message = message.toLowerCase();

    var urls = message.match(CurrentChat.linkify_re);
    if(!urls) return false;
    
    for(var i=0; i<urls.length; i++){
        if(!is_whitelisted_url(urls[i])){
            return true;
        }
    }
    
    return false;
}

function message_is_donger(message){
    var nonASCII = 0;
    for(var i = 0; i < message.length; i++) {
        if(message.charCodeAt(i) > 127) {
            nonASCII++;
            if(nonASCII > MAXIMUM_NON_ASCII_CHARACTERS){
                return true;
            }
        }
    }
    return false;
}

function message_is_small(message){
    return message.split(/\s/g).length < MINIMUM_MESSAGE_WORDS;
}

var message_has_duplicate_url = function(message){
    
    // An URL is here defined as:
    // [http[s]://][www.]domainname.domain[/path[.filetype_like_png][?query_string]]
    // Any urls where the .domain to query (except for whats after the last '=' is equal,
    // will be considered identical.
    
    // The commented out regex doesnt matter if included or not. Commented out since it is useless,
    // but kept as comments because it can be used if something is tweaked
    var url_regex = new RegExp( ""
//        + "(?:https?\\://)?"            // '[http[s]://]'
//        + "[^/\\s]*"                    // '[www.ex.am]'
        + "(\\.[^\\.\\s]{1,3}"            // '.ple'
        + "(?:/[^\\.\\s]+"                // '[/possible/path]'
            + "(?:\\.[^\\.\\s]{1,3})?" // '[.file]'
        + ")?"
        + "(?:\\?[^\\.\\s]+\\=[^\\.\\s]+" // '[?a=query]'
            + "(?:&[^\\.\\s]+\\=[^\\.\\s]+])*" // '[&for=stuff]'
        + ")?)"
        , "gi"); // global and case-insensitive.
    
    var urls = [];
    var regexec;
    while ((regexec = url_regex.exec(message)) !== null)
    {
         // drop last query-value, useful if the url isnt followed by a space before the next word.
        var withoutLastQueryValue = /(\S*\=)\S*?/gi.exec(regexec[1]);
        if (withoutLastQueryValue == null) {
            urls.push(regexec[1]);
        } else {
            urls.push(withoutLastQueryValue[1]);
        }
    }
    
    if (urls != null) {
        // Would have prefered finding a standard lib functino for this...
        // But credits to http://stackoverflow.com/a/7376645 for this code snippet
        // Straight forward and kinda obvious, except for the note about
        // Object.prototype.hasOwnProperty.call(urlsSoFar, url)
        var urlsSoFar = {};
        for (var i = 0; i < urls.length; ++i) {
            var url = urls[i];
            if (Object.prototype.hasOwnProperty.call(urlsSoFar, url)) {
                return true;
            }
            urlsSoFar[url] = true;
        }
    }
    
    //If we've gotten here, then we've passed all of our tests; the message is valid
    return false;
    
};

var convert_allcaps = function(message) {
    //Only convert words preceded by a space, to avoid
    //converting case-sensitive URLs.
    return message.replace(/(^|\s)(\w+)/g, function(msg){ return msg.toLowerCase() });
};


// --- Filtering ---

var filters = [
  { name: 'TppFilterCommand',
    comment: "Hide commands (up, down, anarchy, etc)",
    isActive: true,
    predicate: message_is_command
  },
  
  { name: 'TppFilterLink',
    comment: "Hide messages with non-whitelisted URLs",
    isActive: true,
    predicate: message_is_forbidden_link
  },
  
  { name: 'TppFilterDuplicateURL',
    comment: "Hide duplicate URLS",
    isActive: true,
    predicate: message_has_duplicate_url
  },
  
  { name: 'TppFilterDonger',
    comment: "Hide dongers and ascii art. ヽ༼ຈل͜ຈ༽ﾉ",
    isActive: false,
    predicate: message_is_donger
  },
  
  { name: 'TppFilterSmall',
    comment: "Hide one-word messages (Kappa, \"yesss!\", etc)",
    isActive: false,
    predicate: message_is_small
  },
  
  { name: 'TppFilterSpam',
    comment: 'Hide Misty spam',
    isActive: false,
    predicate: message_is_misty
  },
];



var rewriters = [
   { name: 'TppConvertAllcaps',
     comment: "Convert ALLCAPS to lowercase",
     isActive: true,
     rewriter: convert_allcaps
   }
];


var all_options = [].concat(filters).concat(rewriters);

function passes_active_filters(message){
    for(var i=0; i < filters.length; i++){
        var filter = filters[i];
        if(filter.isActive && filter.predicate(message)){
            //console.log("Filter", filter.name, message);
            return false;
        }
    }
    return true;
}

function rewrite_with_active_rewriters(message){
    var newMessage = message;
    for(var i=0;  i < rewriters.length; i++){
        var rewriter = rewriters[i];
        if(rewriter.isActive){
            newMessage = (rewriter.rewriter(newMessage) || newMessage);
        }
    }
    return newMessage;
}

// --- UI ---

function initialize_ui(){

    //TODO: #chat_line_list li.fromjtv

    var customCssParts = [
        "#chat_line_list .TppFiltered {display:none;}"
    ];
    
    var customStyles = document.createElement("style");
    customStyles.appendChild(document.createTextNode(customCssParts.join("")));

    var controlPanel = document.createElement("div");
    controlPanel.id = "TppControlPanel";
    controlPanel.className = "hidden";
    
    var panelTable = document.createElement("table");
    controlPanel.appendChild(panelTable);
    
    all_options.forEach(function(option){
        var tr = document.createElement("tr");
        panelTable.appendChild(tr);
        
        var td;
        
        td = document.createElement("td");
        var ipt = document.createElement("input");
        ipt.type = "checkbox";
        ipt.checked = option.isActive; // <---
        td.appendChild(ipt);
        tr.appendChild(td);
        
        td = document.createElement("td");
        td.appendChild(document.createTextNode(option.comment)); // <---
        
        tr.appendChild(td);
        
        $(ipt).click(function(){
            option.isActive = !option.isActive;
            update_chat_with_filter();
        });
        
    });
    
    var controls = document.getElementById("controls");
    document.body.appendChild(customStyles);
    
    //use a default jtv style for button so it looks natural and works with BetterTTV
    var toggleControlPanel = $("<div>", {
        style: "background-image: none !important; margin-bottom: 5px;",
        className: "dropdown_static"
    });
    toggleControlPanel.text("Chat Filter Settings");
    
    //create arrow using jtv styles/images
    var icon = $("<span>", {style: "background-image: url('../images/xarth/left_col_dropdown_arrow.png'); background-position: 50% -32px; height: 10px; margin-left: 10px; width: 10px; background-repeat: no-repeat; display: inline-block;"});
    toggleControlPanel.append(icon);
    toggleControlPanel.click(function(){
        $(controlPanel).toggleClass("hidden");
        //flip arrow
        icon.css('background-position', (icon.css('background-position') == '50% -7px') ? '50% -32px' : '50% -7px' );
    });
    $(controls).append(toggleControlPanel);
    controls.appendChild(controlPanel);
}


// --- Main ---

function update_chat_with_filter(){
    if(!CurrentChat) return; //Chat hasnt loaded yet.

    $('#chat_line_list li').each(function() {
        var chatLine = $(this);
        var chatText = chatLine.find(".chat_line").text();
        
        if(passes_active_filters(chatText)){ 
            chatLine.removeClass("TppFiltered");
        }else{
            chatLine.addClass("TppFiltered");
        }
    });
}

function initialize_filter(){
    CurrentChat = myWindow.CurrentChat;
    
    update_chat_with_filter();
    
    var original_insert_chat_line = CurrentChat.insert_chat_line;
    CurrentChat.insert_chat_line = function(info) {
        if(!passes_active_filters(info.message)){ return false }
        info.message = rewrite_with_active_rewriters(info.message);
        
        //console.log("----", info.message);
        
        return original_insert_chat_line.apply(this, arguments);
    };
}

$(function(){
    //Checking for the spinner being gone is a more reliable way to chack
    //if the CurrentChat is fully loaded.
    var chatLoadedCheck = setInterval(function () {
        if($("#chat_loading_spinner").css('display') == 'none'){
            clearInterval(chatLoadedCheck);
            initialize_ui();
            initialize_filter();
        }
    }, 100);
});
    
}());
