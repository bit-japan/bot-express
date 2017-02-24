'use strict';

const REQUIRED_OPTIONS = ["line_channel_id", "line_channel_secret", "line_channel_access_token", "apiai_client_access_token", "default_skill"];
const DEFAULT_MESSAGE_PLATFORM_TYPE = "line";
const DEFAULT_MEMORY_RETENTION = 60000;
const DEFAULT_SKILL_PATH = "../../skill/";

let express = require("express");
let router = express.Router();
let body_parser = require("body-parser");
let memory = require("memory-cache");
let start_conversation_flow = require('./flow/start_conversation');
let reply_flow = require('./flow/reply');
let change_intent_flow = require('./flow/change_intent');
let change_parameter_flow = require('./flow/change_parameter');
let no_way_flow = require('./flow/no_way');
let Line = require("./service/line");
let Apiai = require("./service/apiai");

router.use(body_parser.json({
    verify: (req, res, buf, encoding) => {
        req.rawBody = buf;
    }
}));

module.exports = (options) => {

    // Check if required options are set.
    for (let req_opt of REQUIRED_OPTIONS){
        if (typeof options[req_opt] == "undefined"){
            throw(`Required option: "${req_opt}" not set`);
        }
    }
    console.log("Required options all set.");

    // Set optional options.
    options.message_platform_type = options.message_platform_type || DEFAULT_MESSAGE_PLATFORM_TYPE;
    options.memory_retention = options.memory_retention || DEFAULT_MEMORY_RETENTION;
    if (!!options.skill_path){
        options.skill_path = "../../" + options.skill_path;
    } else {
        options.skill_path = DEFAULT_SKILL_PATH;
    }
    if (options.enable_ask_retry === null){
        options.enable_ask_retry = false;
    }
    options.message_to_ask_retry = options.message_to_ask_retry || "ごめんなさい、もうちょっと正確にお願いできますか？";


    // Instantiate api.ai instance
    let apiai = new Apiai(options.apiai_client_access_token);

    // Webhook Process
    router.post('/', function(req, res, next){
        res.status(200).end();

        // Instantiate Message Platform based class.
        let message_platform;
        switch(options.message_platform_type){
            case "line":
                message_platform = new Line(options.line_channel_id, options.line_channel_secret, options.line_channel_access_token);
            break;
            default:
                throw(`Unsupported message platform type: "${options.message_platform_type}"`);
            break;
        } // End of Instantiate Message Platform.
        console.log("Message Platform instantiated.");

        // Signature Validation
        switch(options.message_platform_type){
            case "line":
                if (!message_platform.validate_signature(req.get('X-Line-Signature'), req.rawBody)){
                    throw(`Signature validation failed.`);
                }
            break;
            default:
                throw(`Unsupported message platform type: "${options.message_platform_type}"`);
            break;
        } // End of Signature Validation
        console.log("Signature Validation suceeded.");

        // Process Event
        let bot_events = [];
        switch(options.message_platform_type){
            case "line":
                bot_events = req.body.events;
            break;
            default:
                throw(`Unsupported message platform type: "${options.message_platform_type}"`);
            break;
        }
        for (let bot_event of bot_events){
            console.log(bot_event);

            // Recall Memory
            let memory_id;
            switch(options.message_platform_type){
                case "line":
                    memory_id = bot_event.source.userId;
                break;
                default:
                    throw(`Unsupported message platform type: "${options.message_platform_type}"`);
                break;
            }
            let conversation = memory.get(memory_id);
            let promise_flow_completed;
            let flow;

            if (!conversation){
                /*
                ** Start Conversation Flow.
                */

                // Check if this event type is supported in this flow.
                switch(options.message_platform_type){
                    case "line":
                        if (bot_event.type != "message" || bot_event.message.type != "text"){
                            console.log(`This is unsupported event type in this flow so skip processing.`);
                            return;
                        }
                    break;
                    default:
                        throw(`Unsupported message platform type: "${options.message_platform_type}"`);
                    break;
                } // End of Check if this event type is supported in this flow.
                console.log("This event tyep is supported.");

                // Set session id for api.ai and text to identify intent.
                let session_id;
                let text;
                switch(options.message_platform_type){
                    case "line":
                        session_id = bot_event.source.userId;
                        text = bot_event.message.text;
                    break;
                    default:
                        throw(`Unsupported message platform type: "${options.message_platform_type}"`);
                    break;
                } // End of Set session id for api.ai and text to identify intent.

                promise_flow_completed = apiai.identify_intent(session_id, text).then(
                    (response) => {
                        console.log(`Intent is ${response.result.action}`);

                        // Instantiate the conversation object. This will be saved as Bot Memory.
                        conversation = {
                            intent: response.result,
                            confirmed: {},
                            to_confirm: {},
                            confirming: null,
                            previous: {
                                confirmed: []
                            }
                        };
                        try {
                            flow = new start_conversation_flow(message_platform, bot_event, conversation, options);
                        } catch(err) {
                            return Promise.reject(err);
                        }
                        return flow.run();
                    },
                    (response) => {
                        console.log("Failed to identify intent.");
                        return Promise.reject(response);
                    }
                );
            // End of Start Conversation Flow.
            } else {
                if (!!conversation.confirming){
                    /*
                    ** Reply Flow
                    */

                    // Check if the event is supported one in this flow.
                    switch(options.message_platform_type){
                        case "line":
                            if ((bot_event.type != "message" || bot_event.message.type != "text") && bot_event.type != "postback" ){
                                console.log("This is unsupported event type in this flow.");
                                return;
                            }
                        break;
                        default:
                            throw(`Unsupported message platform type: "${options.message_platform_type}"`);
                        break;
                    }

                    try {
                        flow = new reply_flow(message_platform, bot_event, conversation, options);
                    } catch(err){
                        return Promise.reject(err);
                    }
                    promise_flow_completed = flow.run();
                    // End of Reply Flow
                } else {
                    // Check if this is Change Intent Flow from event type.
                    let session_id;
                    let text;
                    let possibly_change_intent_flow = false;
                    switch (options.message_platform_type){
                        case "line":
                            if (bot_event.type == "message" && bot_event.message.type == "text"){
                                session_id = bot_event.source.userId;
                                text = bot_event.message.text;
                                possibly_change_intent_flow = true;
                            }
                        break;
                        default:
                            throw(`Unsupported message platform type: "${options.message_platform_type}"`);
                        break;
                    }

                    // Check if this is Change Intent Flow.
                    if (possibly_change_intent_flow){
                        promise_flow_completed = apiai.identify_intent(session_id, text).then(
                            (response) => {
                                if (response.result.action != "input.unknown"){
                                    /*
                                    ** Change Intent Flow
                                    */

                                    // Set new intent while keeping other data.
                                    conversation.intent = response.result;
                                    try {
                                        flow = new change_intent_flow(message_platform, bot_event, conversation, options);
                                    } catch(err){
                                        return Promise.reject(err);
                                    }
                                    return flow.run();
                                    // End of Change Intent Flow
                                } else {
                                    if (conversation.previous.confirmed.length > 0 && conversation.intent.action != "input.unknown"){
                                        /*
                                        ** Assume this is Change Parameter Flow.
                                        */
                                        try {
                                            flow = new change_parameter_flow(message_platform, bot_event, conversation, options);
                                        } catch(err){
                                            return Promise.reject(err);
                                        }
                                        return flow.run().then(
                                            (response) => {
                                                // Now it is confirmed this is Change Parameter Flow.
                                                return response;
                                            },
                                            (response) => {
                                                if (response == "no_fit"){
                                                    /*
                                                    ** Now it turned to be No Way Flow.
                                                    */
                                                    try {
                                                        flow = new no_way_flow(message_platform, bot_event, conversation, options);
                                                    } catch(err){
                                                        return Promise.reject(err);
                                                    }
                                                    return flow.run();
                                                }
                                            }
                                        ); // End of Assume this is Change Parameter Flow.
                                    } else {
                                        /*
                                        ** No Way Flow.
                                        */
                                        try {
                                            flow = new no_way_flow(message_platform, bot_event, conversation, options);
                                        } catch(err){
                                            return Promise.reject(err);
                                        }
                                        return flow.run();
                                    }
                                }
                            },
                            (response) => {
                                // Failed to identify intent.
                                return Promise.reject(response);
                            }
                        );
                    } else {
                        if (conversation.previous.confirmed.length > 0 && conversation.intent.action != "input.unknown"){
                            /*
                            ** Assume this is Change Parameter Flow.
                            */
                            try {
                                flow = new change_parameter_flow(message_platform, bot_event, conversation, options);
                            } catch(err){
                                return Promise.reject(err);
                            }
                            return flow.run().then(
                                (response) => {
                                    // It is confirmd this is Change Parameter Flow.
                                    return response;
                                },
                                (response) => {
                                    if (response == "no_fit"){
                                        // It turned out to be No Way Flow.
                                        try {
                                            flow = new no_way_flow(message_platform, bot_event, conversation, options);
                                        } catch(err){
                                            return Promise.reject(err);
                                        }
                                        return flow.run();
                                    }
                                }
                            ); // End of Assume this is Change Parameter Flow.
                        } else {
                            /*
                            ** No Way Flow
                            */
                            try {
                                flow = new no_way_flow(message_platform, bot_event, conversation, options);
                            } catch(err){
                                return Promise.reject(err);
                            }
                            return flow.run();
                        }
                    }
                }
            }

            // Completion of Flow
            promise_flow_completed.then(
                (response) => {
                    console.log("End of webhook process.");
                    console.log(flow.conversation);

                    // Update memory.
                    memory.put(memory_id, flow.conversation, options.memory_retention);
                },
                (response) => {
                    console.log("Failed to process event.");
                    console.log(response);

                    // Clear memory.
                    memory.put(memory_id, null);
                }
            ); // End of Completion of Flow

        }; // End of Process Event
    });

    return router;
}