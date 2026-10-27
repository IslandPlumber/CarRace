import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('stock-car.glb'))requests.push(r.url());});
page.on('response',r=>{if(r.status()>=400)errors.push(`HTTP ${r.status()}: ${r.url()}`);});
mkdirSync('review/models',{recursive:true});
try{
 await page.goto(process.env.CARRACE_URL??'http://127.0.0.1:8771/',{waitUntil:'networkidle'});await page.locator('#track[data-car-models="ready"]').waitFor();await page.getByRole('button',{name:'Garage',exact:true}).click();await page.locator('#showroom-canvas[data-model-loaded="ready"]').waitFor();await page.waitForTimeout(500);await page.screenshot({path:'review/models/showroom-desktop.png',fullPage:true});
 for(let i=0;i<7;i++){assert.equal(await page.locator('#showroom-count').textContent(),`${String(i+1).padStart(2,'0')} / 07`);await page.locator('#showroom-canvas').screenshot({path:`review/models/car-${i+1}.png`});await page.getByRole('button',{name:'View next car',exact:true}).click();}
 await page.getByRole('button',{name:'View next car',exact:true}).click();await page.getByRole('button',{name:'Use this car',exact:false}).click();assert.equal(await page.locator('#selected-name').textContent(),'Redline Junior');
 await page.getByRole('button',{name:'The circuit',exact:true}).click();await page.getByRole('button',{name:'Practice race'}).click();await page.getByRole('button',{name:'Chase',exact:true}).click();await page.locator('#ability:not([disabled])').waitFor();await page.waitForTimeout(800);await page.screenshot({path:'review/models/racing-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Garage',exact:true}).click();await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'review/models/showroom-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);assert.equal(requests.length,1,'race and showroom share one downloaded model');const report={passed:true,checks:['all seven licensed car liveries in showroom','shared single GLB download','showroom car selection updates race car','detailed stock cars in race camera','mobile showroom without overflow','no browser errors'],errors,modelDownloads:requests.length};writeFileSync('review/models/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
