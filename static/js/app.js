"use strict";

// A convenience preview. Submitted calculations are always validated on the server.
document.querySelectorAll("[data-simulator]").forEach((form) => {
  const weightedTotal = Number(form.dataset.weightedTotal);
  const existingWeight = Number(form.dataset.totalWeight);
  const result = form.querySelector("[data-live-result]");
  const output = form.querySelector("[data-live-percentage]");
  const targetNote = form.querySelector("[data-live-target]");
  const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

  function updatePreview() {
    let futureWeighted = 0;
    let futureWeight = 0;
    let hasScore = false;
    let invalid = false;

    for (let index = 0; index < 3; index += 1) {
      const scoreField = form.querySelector(`[name="future-${index}-earned"]`);
      const possibleField = form.querySelector(`[name="future-${index}-possible"]`);
      const weightField = form.querySelector(`[name="future-${index}-weight"]`);
      if (!scoreField || !possibleField || !weightField) continue;
      const earnedText = scoreField.value.trim();
      const possibleText = possibleField.value.trim();
      const weightText = weightField.value.trim();
      const fieldsValid = scoreField.validity.valid && possibleField.validity.valid && weightField.validity.valid;
      if (!earnedText && !possibleText && !weightText) {
        if (!fieldsValid) invalid = true;
        continue;
      }
      const earned = Number(earnedText);
      const possible = Number(possibleText);
      const weight = Number(weightText);
      if (!earnedText || !possibleText || !weightText || !Number.isFinite(earned) || !Number.isFinite(possible)
          || !Number.isFinite(weight) || earned < 0 || possible < 0.0001 || earned > possible || weight < 0.0001
          || earned > 999999 || possible > 999999 || weight > 999999 || !fieldsValid) {
        invalid = true;
        continue;
      }
      hasScore = true;
      futureWeight += weight;
      futureWeighted += (earned / possible * 100) * weight;
    }

    if (!result || !output || !targetNote) return;
    if (invalid || !hasScore || !Number.isFinite(weightedTotal) || !Number.isFinite(existingWeight)) {
      result.hidden = true;
      return;
    }

    const targetField = form.querySelector('[name="target_percentage"]');
    const target = targetField && targetField.value.trim() ? Number(targetField.value) : null;
    if (target === null || !Number.isFinite(target) || target < 0 || target > 100
        || (targetField && !targetField.validity.valid)) {
      result.hidden = true;
      return;
    }
    const projected = (weightedTotal + futureWeighted) / (existingWeight + futureWeight);
    if (!Number.isFinite(projected)) {
      result.hidden = true;
      return;
    }
    output.textContent = `${formatter.format(projected)}%`;
    if (target !== null && Number.isFinite(target) && target >= 0 && target <= 100) {
      const needed = (target * (existingWeight + futureWeight) - weightedTotal) / futureWeight;
      if (needed > 100) {
        targetNote.textContent = `A ${formatter.format(target)}% target needs more than 100% across these future weights. Try adding more future assessments.`;
      } else if (needed <= 0) {
        targetNote.textContent = `Your ${formatter.format(target)}% target is already secured for these future weights, even with a 0% future average.`;
      } else {
        targetNote.textContent = `You need a weighted average of ${formatter.format(needed)}% across these future assessments to reach ${formatter.format(target)}%.`;
      }
    } else {
      targetNote.textContent = "Preview only. Your recorded grades stay the same.";
    }
    result.hidden = false;
  }

  form.addEventListener("input", updatePreview);
  updatePreview();
});
