const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('docs/script.js', 'utf8');
const start = source.indexOf('    async function logRecipe(');
const end = source.indexOf('    async function render()', start);
let saves = 0;
const context = {
    selectedFoods: {whey: {name:'Whey',protein_per_serving:25,servings:1}},
    roundTo2: n => Math.round(n * 100) / 100,
    renderSelectedFoods() {},
    async autosaveProteinEntry() { saves++; },
    status: {}
};
vm.createContext(context);
vm.runInContext(source.slice(start,end),context);
(async () => {
    const recipe = {id:'shake',name:'Shake',ingredients:[
        {id:'whey',name:'Whey',protein_per_serving:25,servings:1},
        {id:'oats',name:'Oats',protein_per_serving:5,servings:0.5}
    ]};
    const control = {disabled:false};
    await context.logRecipe(recipe,control);
    await context.logRecipe(recipe,control);
    const group = context.selectedFoods['recipe:shake'];
    assert.equal(group.servings,2);
    assert.equal(group.protein_per_serving,27.5);
    assert.equal(Object.values(context.selectedFoods).reduce((n,f)=>n+f.servings*f.protein_per_serving,0),80);
    recipe.ingredients[0].servings=10;
    assert.equal(group.ingredients[0].servings,1);
    assert.equal(JSON.parse(JSON.stringify(group)).kind,'recipe');
    assert.equal(saves,2);
    assert.equal(control.disabled,false);
    console.log('PASS: recipe grouping, repeated servings, separate foods, snapshot persistence and totals');
})().catch(error=>{console.error(error);process.exitCode=1;});
