const { Int62 } = require("../int62-js")
const { benchmark } = require("hotloop")

let hi30 = (Math.random() * 0x100000000) >>> 2;
let lo32 = 0;
let sum = 0;

benchmark("js", () => {
    sum += Int62(hi30, lo32++);
});

console.log(sum);  // Side-effect using computed result to prevent dead code elimination
