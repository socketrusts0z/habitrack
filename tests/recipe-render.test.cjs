const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
// Minimal DOM fixture that preserves parent/child query semantics.
class Element {
    constructor(name) { this.name=name; this.children=[]; this.className=''; this.dataset={}; this.attributes={}; this.style={}; this.classList={add:name=>this.className+=' '+name}; }
    get firstChild() { return this.children[0] || null; }
    append(...nodes) { for(const node of nodes) { if(node.parent) node.parent.children.splice(node.parent.children.indexOf(node),1);node.parent=this;this.children.push(node); } }
    appendChild(node) { this.append(node); }
    set innerHTML(value) {
        this.children=[];
        if (!value) return;
        for(const className of ['selected-food-label','selected-food-controls','selected-food-step','selected-food-serving-value','selected-food-step','selected-food-remove']) {
            const node=new Element('span');node.className=className;this.append(node);
        }
    }
    querySelectorAll(selector) {
        return this.children.flatMap(child=>[...(child.className.split(' ').includes(selector.slice(1))?[child]:[]),...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    setAttribute(key,value) { this.attributes[key]=value; }
    addEventListener(type,handler) { this[type]=handler; }
}
const source=fs.readFileSync('docs/script.js','utf8');
const nodes=Object.fromEntries(['selected-foods-list','protein-total-amount'].map(id=>[id,new Element('div')]));
const foods={'recipe:shake':{name:'Shake',kind:'recipe',servings:1,protein_per_serving:30,ingredients:[{name:'Whey',servings:1,protein_per_serving:25},{name:'Oats',servings:1,protein_per_serving:5}]}};
const context={selectedFoods:foods,el:id=>nodes[id],document:{createElement:name=>new Element(name)},sanitizeServings:Number,roundTo2:n=>Math.round(n*100)/100,formatNumber:String};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function renderSelectedFoods()'),source.indexOf('async function loadDailySelections(')),context);
context.renderSelectedFoods();
const group=nodes['selected-foods-list'].firstChild;
assert.ok(group.className.includes('logged-recipe'));
assert.equal(group.querySelector('.selected-food-remove').attributes['aria-label'],'Remove recipe');
assert.equal(group.querySelector('.logged-recipe-ingredients').children.length,2);
assert.equal(nodes['protein-total-amount'].textContent,'30g');
console.log('PASS: actual recipe renderer mounts group, ingredient rows, controls and protein total');
