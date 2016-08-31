'use strict';

const Console = require('console').Console;
const fs = require('fs');
const spawn = require('child_process').spawn;
const SMTPConnection = require('smtp-connection');

var last_error = "";

var logger = null; 
var smtp_connection = null;

var logs_dir = ".";
var working_dir = ".";
var timeout = 0;
var app = "";
var app_args = [];

var email_config_obj = null;

const options_time_file = { timezone: 'UTC',
						   	year: 'numeric',
						   	day: 'numeric',
						    hour: 'numeric',
				            minute: 'numeric',
				            second: 'numeric'};

const options_time_log = {  timezone: 'UTC',
  							hour: 'numeric',
  							minute: 'numeric',
  							second: 'numeric'}


function help_usage(){
	console.log("Usage: LoopLauncher [KEY]... [APP]... [ARGS]...");
	console.log("Keys:");
	console.log("-c config.json                setup launcher by config file");
	console.log("-d path                       set working dir");
	console.log("-l path                       set logs dir");
	console.log("-t secs                       set restarting timeout")
	console.log("-h                            show this help");
	console.log("-e email.json                 setup email alerts");
}

function setup_email(callback){
	var options = {
		port: email_config_obj.port,
		host: email_config_obj.host,
		secure: email_config_obj.secure,
	};

	smtp_connection = new SMTPConnection(options);
	smtp_connection.connect(callback);
}


function send_email(error_code){
	setup_email(function(){
		if(smtp_connection){
			
			var callback = function(err){
				if(err){
					console.log(err);
					return;
				}

				var message = 
				"Subject: Application crashed!\n"+
				"From: LoopLauncher\n"+ 
				"Content-Type: text/plain; charset=utf-8; format=flowed\n"+
				"Content-Transfer-Encoding: 8bit\n"+
				"\n"+
				(new Date()).toLocaleString() + "\n" +
				"Application '" + app + " " + app_args.join(" ") + "' has been crashed with return code: " + error_code + "\n\n" +
				"Last error line:\n"+
				last_error;

				var envelope = {
					from: email_config_obj.from,
					to: email_config_obj.to
				};

				smtp_connection.send(envelope, message, function on_msg_send(err, info){
					if(!err){
						console.log(info);
					}else{
						console.log(err);
					}

					smtp_connection.quit();
				});
			}

			smtp_connection.login({
			    user: email_config_obj.user,
			    pass: email_config_obj.pass
			}, callback);
		}
	});
}

function get_time_file(){
	return (new Date()).toLocaleString("ru", options_time_file);
}

function get_time_log(){
	return (new Date()).toLocaleString("ru", options_time_log);
}

function setup_logger(dir){
	const output = fs.createWriteStream(dir + '/' + get_time_file() + ".log", {flags: "a"});
	logger = new Console(output, output);
}

function parse_proc_args(callback){
	const args = process.argv;

	var dir = false;
	var arg_timeout = false;
	var arg_logs_dir = false;
	var arg_app = false;
	var arg_app_args = false;
	var email_config = false;
	var config = false;

	for(var i = 2; i < args.length; ++i){

		switch(args[i]){
			case "-d":
			{
				if(dir || i == args.length - 1){
					callback(true);
					return;
				}

				dir = true;
				working_dir = args[++i];
				break;
			}
			
			case "-l":
			{
				if(arg_logs_dir || i == args.length - 1){
					callback(true);
					return;
				}

				arg_logs_dir = true;
				logs_dir = args[++i];

				setup_logger(logs_dir);
				break;
			}
			
			case "-t":{
				if(arg_timeout || i == args.length - 1){
					callback(true);
					return;
				}

				arg_timeout = true;
				timeout = parseInt(args[++i]);

				if(isNaN(timeout)){
					callback(true);
					return;
				}
				break;
			}

			case "-e":{
				if(email_config || i == args.length - 1){
					callback(true);
					return;
				}

				email_config = true;
				try{
					email_config_obj = JSON.parse(fs.readFileSync(args[++i], "utf8"));
				}catch(ex){
					callback(true);
					return;
				}
				break;
			}

			case "-c":{
				if(config || i == args.length - 1){
					callback(true);
					return;
				}

				config = true;
				try{
					var config_obj = JSON.parse(fs.readFileSync(args[++i], "utf8"));

					// var logs_dir = ".";
					// var working_dir = ".";
					// var timeout = 0;
					// var app = "";
					// var app_args = [];

					app = config_obj.command;
					app_args = config_obj.args;
					working_dir = config_obj.working_dir;
					logs_dir = config_obj.logs_dir;
					timeout = config_obj.timeout;
					email_config_obj = config_obj.email_config;
				}catch(ex){
					console.log(ex.message);

					callback(true);
					return;
				}
				break;
			}
			
			default:
			{
				if(args[i].trim()[0] == '-'){
					console.log("Unknown key " + args[i] + '\n');
					callback(true);
					return;
				}

				if(!arg_app){
					arg_app = true;
					app = args[i];
				}else{
					arg_app_args = true;
					app_args.push(args[i]);
				}
				// else{
				// 	callback(true);
				//  return;
				// }
			}
		}
	}

	if(!arg_app && !config){ // not set app's executable path
		callback(true);
		return;
	}

	callback(false); //no errors
}

function remove_newline(data){
	if(data[data.length - 1] == 10){
		return data.slice(0, -1);
	}
	return data;
}

function start_loop(){
	try{
		if(logger === null){
			setup_logger(logs_dir);
		}

		const proc = spawn(app, app_args);
		
		proc.on('error', (err) => {
			var time = get_time_log();
			logger.log(`[${time}] ${err}`);
			logger.log(`-------------`);

	  		console.log('Failed to start child process: ' + err + '\n' + 'Quitting...\n');
		});

		proc.stdout.on('data', (data) => {
			data = remove_newline(data);

			var time = get_time_log();
			var log = `[${time}] ${data}`;

			logger.log(log);
			console.log(log);
		});

		proc.stderr.on('data', (data) => {
			data = remove_newline(data);

			var time = get_time_log();
			var log = `[${time}][ERROR] ${data}`;

			logger.log(log);
			console.log(log);

			last_error = log;
		});

		proc.on('close', (code) => {
			if(code !== 0 && email_config_obj !== null){
				send_email(code);
			}

			logger.log(`\nChild process exited with code ${code}`);
			logger.log('\n\n-------------\nRestarting...');
		 	

		 	console.log(`\n\nChild process exited with code ${code}`);
		 	console.log(`Trying to restart process...\n\n`);

		 	if(timeout != 0){
		 		setTimeout(function() {
		 			start_loop();
		 		}, timeout * 1000);
		 	}else{
		 		start_loop();
		 	}
		});
	}catch(ex){
		console.log('Can\'t run "' + app + '" by reason:\n' + ex);
	}
}

parse_proc_args( (err) => {
	if(!err){
		start_loop();
	}else{
		help_usage();
	}
});