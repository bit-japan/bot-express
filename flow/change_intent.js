'use strict';

/*
** Import Packages
*/
let Promise = require('bluebird');
let Flow = require("./flow");


module.exports = class ChangeIntentFlow extends Flow {
    /*
    ** ### Change Intent Flow ###
    ** - Check if the event is supported one in this flow.
    ** - If we find some parameters from message, add them to the conversation.
    ** - Run final action.
    */

    constructor(message_platform_type, message_platform, bot_event, conversation, skill_path, default_skill) {
        super(message_platform_type, message_platform, bot_event, conversation, skill_path, default_skill);
    }

    run(){
        console.log("\n### This is Change Intent Flow. ###\n");

        // If we find some parameters from message, add them to the conversation.
        if (this.conversation.intent.parameters && Object.keys(this.conversation.intent.parameters).length > 0){
            for (let param_key of Object.keys(this.conversation.intent.parameters)){
                // Parse and Add parameters using skill specific logic.
                try {
                    super.add_parameter(param_key, this.conversation.intent.parameters[param_key]);
                } catch(err){
                }
            }
        }

        // Run final action.
        return super.finish();
    } // End of run()
};
