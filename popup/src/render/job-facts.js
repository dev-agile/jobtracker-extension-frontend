export function renderJobFacts(factsEl, factItems) {
  if (!factsEl) return;
  factsEl.innerHTML = "";

  factItems.forEach((item) => {
    const row = document.createElement("div");
    row.className = "job-card__fact-row";

    const valueEl = document.createElement("p");
    valueEl.className = "job-card__fact-value";
    valueEl.textContent = item.value;

    const labelEl = document.createElement("p");
    labelEl.className = "job-card__fact-label";
    labelEl.textContent = item.label;

    row.appendChild(valueEl);
    row.appendChild(labelEl);
    factsEl.appendChild(row);
  });

  factsEl.style.display = factItems.length ? "grid" : "none";
}
