const test=require('node:test');const assert=require('node:assert/strict');const phone=require('../public/phone-number.js');
test('R-CTI-14 international dialing accepts formatting but rejects extensions and letters',()=>{
 for(const value of ['+49 89 1234567','00 49 89 1234567','0049 (0)89 1234567','+49 (0)89-1234567'])assert.equal(phone.dial(value),'49891234567');
 for(const value of ['+49 89 1234 ext 5','+4989123456#5','+49ABC1234567','0891234567','21','+0123456789','+4989123+4567'])assert.equal(phone.dial(value),'');
});
test('number lookup uses explicit national context, preserves Italy zero and never suffix matches',()=>{
 assert.notEqual(phone.lookup('0891234567'),phone.lookup('+49891234567'));
 assert.equal(phone.lookup('0891234567',{countryCode:'49',nationalPrefix:'0'}),phone.lookup('+49891234567'));
 assert.equal(phone.lookup('0612345678',{countryCode:'39',nationalPrefix:''}),'390612345678');
 assert.notEqual(phone.lookup('21',{countryCode:'49',nationalPrefix:'0'}),phone.lookup('+498912345621'));
 assert.notEqual(phone.lookup('0891234567',{countryCode:'49'}),phone.lookup('+49891234567'));
});
test('R2-CTI-10 explicit Italy context includes mobile numbers starting with its country code',()=>{
 assert.equal(phone.lookup('3921234567',{countryCode:'39',nationalPrefix:''}),phone.lookup('+393921234567'));
 assert.notEqual(phone.lookup('3921234567'),phone.lookup('+393921234567'));
});
test('R2-CTI-06 one target contract supports internal and international dialing without arbitrary stripping',()=>{
 for(const value of ['1','203','999999'])assert.deepEqual(phone.target(value),{number:value,context:'internal'});
 assert.deepEqual(phone.target('+49 (0)89 1234567'),{number:'49891234567',context:'global'});
 for(const value of ['','1234567','0891234567','+49ABC1234567','203 ext5','+49301234567#2'])assert.equal(phone.target(value),null);
 assert.equal(phone.target('203',{context:'global'}),null);assert.equal(phone.target('+49301234567',{context:'internal'}),null);
});
