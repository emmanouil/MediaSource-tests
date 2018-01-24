'use strict'
/*	This file does the initializing, generic playlist parsing and the MSE actions
 *	For coord-parsing and other function are in processor.js
 *
 *	Timeline for script.js:
 *	We first fetch the playlist
 *	Then the MSE is opened
 *	When the sourceopene is fired we feed the first element of the playlist (we assume to be the init .mp4 file)
 *	After that for each playlist element we check if its coords or segment
 *	And appendNextMediaSegment or handleCoordSet is called
 */

//options
const WITH_COORDS_IN_PL = true;	//backwards compatibility - to be removed
const FULL_LOGS = false;
const PLAYLIST_UPDATE_RATE = 500;	//in ms
var port = '8000';
var playlist_dir = '../out/playlist.m3u8';
var seg_url = 'http://localhost:' + port + '/x64/Debug/out/';
const DISABLE_AUDIO = true;

//vars
var mime_codec = 'video/mp4; codecs="avc1.42c01e"';
var mediaSource = new MediaSource();
var sourceBuffer;
var video, playlist, textTrack, cues;
var playlistArray, playlistPosition = 0;
var req_status = -10;
var pl_timer_ID;
var kill_all = false;

//after window loads do the init
window.onload = function () {
	video = document.getElementById('v');
	mediaSource.video = video;
	video.ms = mediaSource;
	video.src = window.URL.createObjectURL(mediaSource);
	fetch_pl();
	initMSE();
}

//MSE-specific functions
function initMSE() {
	if (req_status == 200 && playlist.length > 0) {
		if (mediaSource.readyState == "open") {
			onSourceOpen();
		} else {
			mediaSource.addEventListener("sourceopen", onSourceOpen);
		}
	} else if (req_status == 200) {
		console.log("[ABORTING] fetched playlist is empty");
	} else {
		console.log("waiting for playlist");
		setTimeout(initMSE, 500);
	}
}

function onSourceOpen() {

	if (mediaSource.sourceBuffers.length > 0)
		return;

	sourceBuffer = mediaSource.addSourceBuffer(mime_codec);
	sourceBuffer.ms = mediaSource;

	//we assume the first playlist element is the location of the init segment
	sourceBuffer.addEventListener('updateend', fetch(playlist[0], addSegment, "arraybuffer"));
}

//Append the initialization segment.
function addSegment() {

	var inSegment = this.response;

	if (inSegment == null) {
		// Error fetching the initialization segment. Signal end of stream with an error.
		console.log("[ERROR] endofstream?")
		mediaSource.endOfStream("network");
		return;
	}

	sourceBuffer.appendBuffer(inSegment);
	playlistPosition++;
	sourceBuffer.addEventListener('updateend', handleNextPlElement, { once: false });
}

//Handle following pl elements
function handleNextPlElement() {

	if (kill_all) {
		console.log("Playlist updates terminated");
		return;
	}
	// Append some initial media data.
	//TODO instead of terminating MSE - poll for new segs
	if (playlistArray[playlistPosition] == null || playlistArray[playlistPosition].length < 3) {
		//mediaSource.endOfStream();
		console.log("[ERROR] endofplaylist?")
		check_playlist();
		return;
	} else if (mediaSource.sourceBuffers[0].updating) {
		console.log('[WARNING] MSE Buffer is still updating')
		//		sourceBuffer.addEventListener('updateend', handleNextPlElement);
	} else {
		//element = playlist.splice(1, 1).toString();
		var element = playlistArray[playlistPosition];
		playlistPosition++;
		if (element.endsWith('.m4s')) { //we have a segment
			fetch(element, appendNextMediaSegment, "arraybuffer");
			if (video.paused)
				start_video();
		} else if (element.endsWith('.txt')) { //we have a coordinates file
			console.log("[WARNING] non-handled .txt element found - Check now!");
		} else if (element.startsWith("T:")) { //we have a coordinate set file	DEPRICATED
			console.log("[WARNING] Depricated format - Check now!");
		} else if (element.length < 2) {
			console.log("possible blank line in playlist - ignoring");
			handleNextPlElement();
		} else {
			console.log("[WARNING] Unknown element in playlist - ignoring " + element);
		}
	}
}


function appendNextMediaSegment(frag_resp) {
	if (FULL_LOGS) {
		console.log("adding to SourceBuffer..")
		console.log("size: " + frag_resp.target.response.byteLength);
		console.log("is in updating status " + sourceBuffer.updating);
	}
	if (mediaSource.readyState == "closed") {
		console.log("[ERROR] closed?")
		return;
	}
	/*
	    // If we have run out of stream data, then signal end of stream.
	    if (!HaveMoreMediaSegments()) {
	      mediaSource.endOfStream();
	      return;
	    }
	*/
	// Make sure the previous append is not still pending.
	if (mediaSource.sourceBuffers[0].updating) {
		console.log("[WARNING] previous mediaSource update still in progress")
		return;
	}

	var mediaSegment = frag_resp.target.response;

	if (!mediaSegment) {
		// Error fetching the next media segment.
		//mediaSource.endOfStream("network");
		console.log("[ERROR] media segment not found");
		return;
	}

	// NOTE: If mediaSource.readyState == “ended”, this appendBuffer() call will
	// cause mediaSource.readyState to transition to "open". The web application
	// should be prepared to handle multiple “sourceopen” events.
	//	mediaSource.sourceBuffers[0].addEventListener('updateend', handleNextPlElement);
	mediaSource.sourceBuffers[0].appendBuffer(mediaSegment);
	if (FULL_LOGS)
		console.log("...added")
}

//Content-loading functions
function fetch(what, where, resp_type) {
	console.log(v.currentTime + " fetching " + what);
	if (what.length < 2) {
		console.log("erroneous request");
	}
	var req = new XMLHttpRequest();
	req.addEventListener("load", where);
	req.open("GET", what);
	if (typeof (resp_type) != 'undefined') {
		req.responseType = resp_type;
	}
	req.send();
}

function fetch_pl() {
	fetch(playlist_dir, parse_playlist);
}

function parse_playlist() {
	playlist = this.responseText.split(/\r\n|\r|\n/); //split on break-line
	playlistArray = playlist.slice();
	req_status = this.status;
}

function check_playlist() {
	fetch(playlist_dir, compare_playlist);
}

function compare_playlist() {
	var pl_in = this.responseText.split(/\r\n|\r|\n/); //split on break-line
	if (typeof pl_in[playlistPosition] !== 'undefined' && pl_in[playlistPosition].length > 3) {
		if (pl_in[playlistPosition] !== playlistArray[playlistPosition]) {
			playlistArray = pl_in.slice();
		}
		handleNextPlElement();
	} else {
		pl_timer_ID = setTimeout(check_playlist, PLAYLIST_UPDATE_RATE);
	}
}

function start_video() {
	console.log('play');
	video.play();
}

function killAll() {
	clearTimeout(pl_timer_ID);
	kill_all = true;
}

function restartServer() {
	var req = new XMLHttpRequest();
	req.open('POST', '');
	req.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
	req.send('reset');
}