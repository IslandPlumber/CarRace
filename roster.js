import {POWERS} from './powers.js';
export const RACERS = Object.freeze([
 {id:'ironhart',name:'Duke Ironhart',number:'03',color:'#252831',accent:'#e9edf1',tag:'THE ENFORCER',sponsor:'IRON',car:'Midnight Thunder',bio:'Black paint. Silver numbers. Absolutely no room given.',style:'Aggressive',stripe:'#bbc1cb'},
 {id:'junior',name:'Redline Junior',number:'88',color:'#e6353e',accent:'#ffb4b4',tag:'THE FAN FAVORITE',sponsor:'REDLINE',car:'Cherry Bomb',bio:'A red rocket, a familiar legacy, and a draft you can trust.',style:'Draft specialist',stripe:'#eeeeeb'},
 {id:'prism',name:'Jett Prism',number:'24',color:'#652fbe',accent:'#d6a3ff',tag:'THE RAINBOW ROCKET',sponsor:'PRISM',car:'Full Spectrum',bio:'Every color on the grid. One very colorful way past the leader.',style:'Precision attacker',stripe:'#ffcf44'},
 {id:'smoke',name:'Troy Smoke',number:'20',color:'#f57421',accent:'#ffb576',tag:'THE HOTHEAD',sponsor:'SMOKE',car:'Orange Outlaw',bio:'Orange sheet metal, a short fuse, and a cloud in your mirror.',style:'Pack disruptor',stripe:'#171e26'},
 {id:'seven',name:'Miles Seven',number:'48',color:'#285cdc',accent:'#83aaff',tag:'THE SERIAL CHAMPION',sponsor:'SEVEN',car:'Cobalt Dynasty',bio:'Cool, calculated, and always there when the checkers fall.',style:'Sustained speed',stripe:'#edf1ec'},
 {id:'candy',name:'Rowdy Candy',number:'18',color:'#a8dd24',accent:'#d6ff7b',tag:'THE WILD CARD',sponsor:'SUGAR',car:'Sugar Rush',bio:'Candy colors. Sharp elbows. A dangerously sweet burst of speed.',style:'Straight-line burst',stripe:'#f5d638'},
 {id:'crown',name:'Ricky Crown',number:'43',color:'#40b8d9',accent:'#a0e7f7',tag:'THE KING OF THE OVAL',sponsor:'CROWN',car:'Royal Blue',bio:'That blue. That number. A royal pain for whoever is in front.',style:'Leader hunter',stripe:'#f0373b'},
].map(r=>Object.freeze({...r,power:POWERS[r.id]})));
export const racerById = id => RACERS.find(r=>r.id===id) ?? RACERS[0];
export function carArt(r) {
 return `<img src="./assets/cars/previews/${r.id}.png" alt="" loading="lazy" decoding="async" aria-hidden="true">`;
}
