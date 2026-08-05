function renderResults(displayText) {
  return `<main><h1>Results for ${displayText}</h1></main>`;
}

function searchHandler(request, response) {
  const displayText = String(request.query.q || "");
  response.send(renderResults(displayText));
}

module.exports = { renderResults, searchHandler };
