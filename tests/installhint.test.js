import test from 'node:test';
import assert from 'node:assert/strict';
import {wantsHint} from '../ui/installhint.js';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
test('the Home Screen tip is for iOS Safari in a tab only',()=>{
  assert.equal(wantsHint({userAgent:IPHONE,standalone:false}),true);
  assert.equal(wantsHint({userAgent:IPAD_DESKTOP,standalone:false,maxTouchPoints:5}),true,'iPadOS reports a Mac with touch');
  assert.equal(wantsHint({userAgent:IPHONE,standalone:true}),false,'already on the Home Screen');
  assert.equal(wantsHint({userAgent:IPHONE,standalone:false},true),false,'display-mode: standalone');
  assert.equal(wantsHint({userAgent:IPHONE}),false,'Chromium emulating an iPhone has no navigator.standalone');
  assert.equal(wantsHint({userAgent:IPAD_DESKTOP,standalone:false,maxTouchPoints:0}),false,'a Mac');
  assert.equal(wantsHint({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',standalone:false}),false,'Chrome on iOS');
  assert.equal(wantsHint({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0',standalone:false}),false,'an in-app browser');
  assert.equal(wantsHint({userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',standalone:false}),false);
  assert.equal(wantsHint(),false);
});
