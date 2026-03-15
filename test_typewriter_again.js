const fullText = "Hello World";
let content = "";
let index = 0;
let inter = setInterval(() => {
  if (index < fullText.length) {
    content += fullText.charAt(index);
    index++;
    console.log(content);
  } else {
    clearInterval(inter);
  }
}, 100);
