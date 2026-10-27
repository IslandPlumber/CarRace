import {chromium} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {RACERS} from '../roster.js';
mkdirSync('assets/cars/previews',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1200,height:1000}});
try{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('http://127.0.0.1:8771/',{waitUntil:'networkidle'});await page.getByRole('button',{name:'Garage',exact:true}).click();await page.locator('#showroom-canvas[data-model-loaded="ready"]').waitFor();
 await page.addStyleTag({content:'.showroom-layout{grid-template-columns:520px 285px!important}.showroom-stage{height:300px!important}.showroom-hint,.showroom-nav{opacity:0!important}'});
 for(const r of RACERS){await page.locator(`#showroom-canvas[data-driver="${r.id}"]`).waitFor();await page.waitForTimeout(150);await page.locator('#showroom-canvas').screenshot({path:`assets/cars/previews/${r.id}.png`});await page.getByRole('button',{name:'View next car',exact:true}).click();}
}finally{await browser.close();}
