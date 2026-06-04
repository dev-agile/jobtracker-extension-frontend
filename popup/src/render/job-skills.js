import { MAX_SKILLS_SHOWN } from "../config.js";
import { shouldHideText } from "../utils/text.js";

export function renderJobSkills(skillsEl, skillsWrapEl, job) {
  if (!skillsEl) return;

  const skillList = (Array.isArray(job.skills) ? job.skills : []).filter(
    (skill) => !shouldHideText(skill)
  );

  skillsEl.innerHTML = "";

  if (!skillList.length) {
    skillsEl.style.display = "none";
    if (skillsWrapEl) skillsWrapEl.style.display = "none";
    return;
  }

  skillList.slice(0, MAX_SKILLS_SHOWN).forEach((skill) => {
    const chip = document.createElement("span");
    chip.className = "job-card__skill-chip";
    chip.textContent = String(skill);
    skillsEl.appendChild(chip);
  });

  skillsEl.style.display = "flex";
  if (skillsWrapEl) skillsWrapEl.style.display = "block";
}
