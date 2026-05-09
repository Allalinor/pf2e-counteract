Hooks.once("init", () => {
  pf2ecac_registerCounteractInLine();
});

Hooks.once("ready", () => {
  document.body.addEventListener("click", pf2ecac_onCounteractButtonClick);
  document.body.addEventListener("click", pf2ecac_onPTCButtonClick);
});

Hooks.on("renderCheckModifiersDialog", pf2ecac_patchCounteractDialog);

let pf2ecac_counteractSourceRank = null;
let pf2ecac_counteractTargetRank = null;
let pf2ecac_counteractDc = null;
let pf2ecac_counteractOriginalSourceRank = null;
let pf2ecac_counteractOriginalTargetRank = null;
let pf2ecac_counteractOriginalDc = null;
let pf2ecac_showDC = null;
let pf2ecac_showOutcome = null;

async function pf2ecac_rollCounteractCheck(actor, rollMode, skipDialog, label, statistic, counteractRank, targetRank, dc, traits = [], rollOptions = [], statKey) {
  const identifier = foundry.utils.randomID();
  const system_domains = statKey === "number" || statKey === "levelBased" ? [] : statistic.domains;
  const domains = ["check","counteract-check", ...system_domains];
  const options = ["counteract","check:statistic:counteract","check:type:check", ...rollOptions, ...traits, identifier];
  const isPlayerOwned = actor.hasPlayerOwner;

  let statLabel;
  if (statKey === "number") {
    statLabel = "Static Number";
  }
  else if (statKey === "levelBased") {
    statLabel = "Level Based";
  }
  else if (statKey === "spell" || statKey === "spellCounteract") {
    statLabel = "Spell Modifier";
  }
  else {
    statLabel =  statistic.label;
  }

  let rollLabel;
  if (label === "Counteract") {
    rollLabel = `${label} Check${statLabel ? ` (${statLabel})` : ""}`;
  } else {
    rollLabel = `${label}${statLabel ? ` (${statLabel} Counteract Check)` : " Counteract Check"}`;
  }

  const result = await game.pf2e.Check.roll(
    new game.pf2e.CheckModifier(rollLabel, statistic),
    {
      actor,
      type: "counteract",
      domains,
      dc: dc ? { value: dc } : undefined,
      options,
      traits,
      createMessage: true,
      skipDialog,
      rollMode,
      messageMode: rollMode
    }
  );

  const message = game.messages.find(m =>
    m.flags?.pf2e?.context?.options?.includes(identifier)
  );
  if (!message) return;

  const updatedSourceRank = pf2ecac_counteractSourceRank;
  const updatedTargetRank = pf2ecac_counteractTargetRank ;
  const updatedDc = pf2ecac_counteractDc;

  const counteractMessage = pf2ecac_generateCounteractMessage(result.degreeOfSuccess, updatedSourceRank, !!updatedDc, updatedTargetRank, pf2ecac_showDC);
  const flavoredCounteract = pf2ecac_showOutcome ? counteractMessage : `<span data-visibility="gm">${counteractMessage}</span>`;

  const hasSource = updatedSourceRank != null;
  const hasTarget = updatedTargetRank != null;

  const updatedSourcePart = hasSource
    ? (!pf2ecac_showDC && !isPlayerOwned
        ? `<span data-visibility="gm">Source Rank ${updatedSourceRank}</span>`
        : `Source Rank ${updatedSourceRank}`)
    : "";

  const updatedTargetPart = hasTarget
    ? (pf2ecac_showDC
        ? `Target Rank ${updatedTargetRank}`
        : `<span data-visibility="gm">Target Rank ${updatedTargetRank}</span>`)
    : "";

  const vsPart = (hasSource && hasTarget)
    ? (pf2ecac_showDC
        ? " VS "
        : ` <span data-visibility="gm">VS</span> `)
    : "";

  const rankPart = (hasSource || hasTarget)
    ? `<strong>${updatedSourcePart}${vsPart}${updatedTargetPart}</strong><br><hr>`
    : "";

  const newFlavor = (message.flavor ?? "") + rankPart + flavoredCounteract;

  const updateData = { flavor: newFlavor };
  
  if (rollMode === "blindroll" || rollMode === "blind") {
    updateData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
  }

  await message.update(updateData);
  if (ui.chat.isAtBottom) await ui.chat.scrollBottom()
}

async function pf2ecac_onCounteractButtonClick(event) {
  const button = event.target.closest(".counteract-roll");
  if (!button) return;

  if (event.target.closest("i[data-pf2-repost]")) return;

  const args = button.dataset.args ? JSON.parse(button.dataset.args) : null;
  if (!args) return;

  const actor = pf2ecac_getSourceToken();
  if (!actor) {
    ui.notifications.warn(`Select one Token.`);
    return;
  }

  const label = button.dataset.label ?? "Counteract";
  let rollMode = pf2ecac_getRollMode(event);
  const skipDialog = pf2ecac_getRollDialog(event);

  const modParts = args.mod.split(":");
  let statistic;
  let statKey = args.mod;

  switch (modParts[0]) {
    case "skill":
      if (modParts[1] === "highest") {
        const skills = Object.entries(actor.skills)
          .filter(([key]) => !key.includes("-lore"));
        if (skills.length === 0) {
          ui.notifications.warn("Actor has no skills.");
          return;
        }
        const highestSkill = skills.reduce((highest, current) => {
          return current[1].check.mod > highest[1].check.mod
            ? current
            : highest;
        });
        statKey = highestSkill[0];
        statistic = highestSkill[1];
      } else {
        statKey = modParts[1];
        statistic = actor.skills?.[statKey];
      }
        if (!statistic) {
          ui.notifications.warn(`Skill: '${pf2ecac_capitalizeFirst(statKey)}' not found on actor.`);
          return;
        }
      break;

    case "lore":
      if (modParts[1] === "highest") {
        const lores = Object.entries(actor.skills)
          .filter(([key]) => key.includes("-lore"));
        if (lores.length === 0) {
          ui.notifications.warn("Actor has no lore skills.");
          return;
        }
        const highestLore = lores.reduce((highest, current) => {
          return current[1].check.mod > highest[1].check.mod
            ? current
            : highest;
        });
        statKey = highestLore[0];
        statistic = highestLore[1];
      } else {
        statKey = `${modParts[1]}-lore`;
        statistic = actor.skills?.[statKey];
      }
      if (!statistic) {
        ui.notifications.warn(`Lore: '${pf2ecac_capitalizeFirst(modParts[1])}' not found on actor.`);
        return;
      }
      break;
  
    case "save":
      if (modParts[1] === "highest") {
        const saves = Object.entries(actor.saves);
        if (saves.length === 0) {
          ui.notifications.warn("Actor has no saves.");
          return;
        }
        const highestSave = saves.reduce((highest, current) => {
          return current[1].check.mod > highest[1].check.mod
            ? current
            : highest;
        });
        statKey = highestSave[0];
        statistic = highestSave[1];
      } else {
        statKey = modParts[1];
        statistic = actor.saves?.[statKey];
        }
        if (!statistic) {
          ui.notifications.warn(`Save: '${pf2ecac_capitalizeFirst(statKey)}' not found on actor.`);
          return;
      }
      break;

    case "spell":
      if (modParts[1] === "counteract") {
        statKey = "spellCounteract";
        statistic = actor.getStatistic("counteract");

        if (!statistic) {
          ui.notifications.warn(`Counteract DC not found on actor.`);
          return;
        }
      } else {
        const tradition = modParts[1];

        const result = pf2ecac_getSpellcastingEntry(actor, tradition);

        if (!result) {
          if (tradition === "highest") {
            ui.notifications.warn(`Can't cast spells.`);
          } else {
          ui.notifications.warn(`Can't cast ${pf2ecac_capitalizeFirst(tradition)} spells.`);
          }
          return;
        }

        statKey = tradition;
        statistic = result.statistic;
      }
      break;

    case "class":
      if (modParts[1] === "highest") {
        statKey = "classDC";
        statistic = actor.classDC;
        if (!statistic) {
          ui.notifications.warn(`Class DC not found on actor.`);
          return;
        }
      } else {
        const classKey = modParts[1];
        statKey = classKey;
        statistic = actor.classDCs?.[classKey];
        if (!statistic) {
          ui.notifications.warn(`Class DC: '${pf2ecac_capitalizeFirst(classKey)}' not found on actor.`);
          return;
        }
      }
      break;

    case "class-spell":
      statKey = `class-spell`;
      const classDCValue = actor.classDC?.mod ?? 0;
      const spellDCValue = pf2ecac_getSpellcastingEntry(actor, 'highest')?.dc - 10 ?? 0;

      statistic = classDCValue >= spellDCValue
        ? actor.classDC
        : pf2ecac_getSpellcastingEntry(actor, 'highest')?.statistic;
      if (!statistic) {
        ui.notifications.warn(`No Class or Spell DC found on actor.`);
        return;
      }
      break;

    case "perception":
      statKey = "perception";
      statistic = actor.perception;
      if (!statistic) {
        ui.notifications.warn(`Perception not found on actor.`);
        return;
      }
      break;

    case "number": {
      let modValue = null;
      let modifier = null;
      if (modParts[1] === "actor-level") {
        modValue = await pf2ecac_getLevelBasedDC(actor);
        if (isNaN(modValue)) {
          ui.notifications.warn(`Invalid flat modifier: ${args.mod}`);
          return;
        }
        statKey = "levelBased";
        modifier = new game.pf2e.Modifier({
          label: "Level Based Modifier",
          slug: "level-based-modifier",
          type: "untyped",
          modifier: modValue
      });        
      } else {
        modValue = Number(modParts[1]);
        if (isNaN(modValue)) {
          ui.notifications.warn(`Invalid flat modifier: ${args.mod}`);
          return;
        }
        statKey = "number";
        modifier = new game.pf2e.Modifier({
          label: "Static Modifier",
          slug: "static-number-modifier",
          type: "untyped",
          modifier: modValue
        });
      }

      statistic = new game.pf2e.StatisticModifier(label, [modifier]);
      break;
    }

    default:
      ui.notifications.warn(`Unknown modifier type: ${args.mod}`);
      return;
  }

  if (args["source-rank"]) {
    if (args["source-rank"] === "actor-level") {
      pf2ecac_counteractSourceRank = Math.ceil(actor.system.details.level.value / 2);
    } else if (args["source-rank"] === "item-level") {
      const itemLevel = Number(args.__itemLevel);
      if (isNaN(itemLevel)) {
        ui.notifications.warn(`Item level not available for counteract.`);
        return;
      }
      pf2ecac_counteractSourceRank = Math.ceil(itemLevel / 2);
    } else if (args["source-rank"] === "spell-rank") {
      const spellRank = Number(args.__spellRank);
      if (isNaN(spellRank)) {
        ui.notifications.warn(`Spell rank not available for counteract.`);
        return;
      }
      pf2ecac_counteractSourceRank = spellRank;
    } else {
      pf2ecac_counteractSourceRank = parseInt(args["source-rank"]);
    }
  }

  if (args["target-rank"]) {
    if (args["target-rank"] === "actor-level") {
      const targets = [...game.user.targets];

      if (targets.length !== 1) {
        ui.notifications.warn("You must target exactly one creature.");
        pf2ecac_counteractTargetRank = null;
      } else {
        const targetActor = targets[0].actor;
        if (!targetActor) {
          ui.notifications.warn("Target has no actor.");
          pf2ecac_counteractTargetRank = null;
        } else {
          pf2ecac_counteractTargetRank = Math.ceil(targetActor.system.details.level.value / 2);
        }
      }
    } else {
      pf2ecac_counteractTargetRank = parseInt(args["target-rank"]);
    }
  }

  pf2ecac_counteractDc = args.dc ? parseInt(args.dc) + (args.adjustment ? parseInt(args.adjustment) : 0) : null;
  
  const inlineTraits = args.traits ? args.traits.split(",").map(t => t.trim()) : [];
  const overrideTraits = args.overrideTraits === true;
  const itemTraits = !overrideTraits && args.__itemTraits ? args.__itemTraits.split(",") : [];
  const traits = [...new Set([...inlineTraits, ...itemTraits])];

  const rollOptions = args["options"] ? args["options"].split(",").map(t => t.trim()) : [];

  const systemOptions = actor.getRollOptions(["all", "dex-skill-check", "str-skill-check"]);
  const itemTraitsOptions = traits.map(t => `item:trait:${t}`);
  const allRollOptions = [...new Set([...systemOptions, ...rollOptions, ...itemTraitsOptions])];

  pf2ecac_counteractOriginalSourceRank = pf2ecac_counteractSourceRank;
  pf2ecac_counteractOriginalTargetRank = pf2ecac_counteractTargetRank;
  pf2ecac_counteractOriginalDc = pf2ecac_counteractDc;

  if (game.system?.id === "pf2e") {
    pf2ecac_showOutcome = game.settings.get("pf2e", "metagame_showResults");
    pf2ecac_showDC = game.settings.get("pf2e", "metagame_showDC");
  }
  else if (game.system?.id === "sf2e") {
    pf2ecac_showOutcome = game.settings.get("sf2e", "metagame_showResults");  
    pf2ecac_showDC = game.settings.get("sf2e", "metagame_showDC");
  }

  if (args.showDC) pf2ecac_showDC = true;
  if (args.hideDC) pf2ecac_showDC = false;

  if (args.showOutcome) pf2ecac_showOutcome = true;
  if (args.hideOutcome) pf2ecac_showOutcome = false;

  if (traits.includes("secret")) {
    rollMode = pf2ecac_setBlindRoll();
  }

  if (rollMode === "blindroll" || rollMode === "blind") {
    pf2ecac_showDC = false;
  }

  requestAnimationFrame(async () => {
    await pf2ecac_rollCounteractCheck(
      actor,
      rollMode,
      skipDialog,
      label,
      statistic,
      pf2ecac_counteractSourceRank,
      pf2ecac_counteractTargetRank,
      pf2ecac_counteractDc,
      traits,
      allRollOptions,
      statKey
    );
  });
}

function pf2ecac_patchCounteractDialog(dialog, $html) {
  const context = dialog?.context;
  const options = Array.isArray(context?.options)
    ? context.options.includes("counteract")
    : context?.options?.has?.("counteract");
  if (!options) return;

  const isGM = game.user.isGM;

  const html = $html[0];
  const container = html.querySelector(".add-modifier-panel");
  if (!container) return;

  const targetHtml = pf2ecac_showDC || isGM
    ? `      <span class="type" style="display: flex; align-items: center; gap: 0.4rem; white-space: nowrap;">
        <span>Target Rank</span>
        <input type="number" name="counteract-target-rank" min="0" value="${pf2ecac_counteractTargetRank ?? ""}" style="width: 4ch; padding: 0.15rem 0.3rem; line-height: 1.1;" />
      </span>`
    : "";

  const dcHtml = pf2ecac_showDC || isGM
    ? `      <span class="value" style="display: flex; align-items: center; gap: 0.4rem; white-space: nowrap;">
        <span>DC</span>
        <input type="number" name="counteract-dc" min="0" value="${pf2ecac_counteractDc ?? ""}" style="width: 4ch; padding: 0.15rem 0.3rem; line-height: 1.1;" />
      </span>`
    : "";

  const section = document.createElement("div");
  section.classList.add("counteract-dialog-fields");
  section.innerHTML = `
    <div class="add-entry-row counteract-input-row" style="display: flex; align-items: center; gap: 1rem;">
      <span class="mod" style="display: flex; align-items: center; gap: 0.4rem; white-space: nowrap;">
        <span>Source Rank</span>
        <input type="number" name="counteract-source-rank" min="0" value="${pf2ecac_counteractSourceRank ?? ""}" style="width: 4ch; padding: 0.15rem 0.3rem; line-height: 1.1;" />
      </span>
${targetHtml}
${dcHtml}
      <span class="counteract-reset" style="display: flex; align-items: center; margin-left: auto;">
        <button type="button" class="counteract-reset" style="padding: 4 0.75rem;">Reset</button>
      </span>
    </div>
    <hr>
  `;

  const target = html.querySelector(".dialog-row.header");
  if (target) {
    target.parentNode?.insertBefore(section, target);
  } else {
    container.parentNode?.insertBefore(section, container);
  }

  const sourceInput = section.querySelector("input[name='counteract-source-rank']");
  const targetInput = section.querySelector("input[name='counteract-target-rank']");
  const dcInput = section.querySelector("input[name='counteract-dc']");
  const resetButton = section.querySelector("button.counteract-reset");

  const form = html.querySelector("form");
  form?.addEventListener("submit", () => {
    if (sourceInput) {
      if (sourceInput.value === "") {
        pf2ecac_counteractSourceRank = null;
      } else {
        const value = sourceInput.valueAsNumber;
        pf2ecac_counteractSourceRank = Number.isNaN(value) ? null : value;
      }
    }

    if (targetInput) {
      if (targetInput.value === "") {
        pf2ecac_counteractTargetRank = null;
      } else {
        const value = targetInput.valueAsNumber;
        pf2ecac_counteractTargetRank = Number.isNaN(value) ? null : value;
      }
    }

    if (dcInput) {
      if (dcInput.value === "") {
        pf2ecac_counteractDc = null;
      } else {
        const value = dcInput.valueAsNumber;
        pf2ecac_counteractDc = Number.isNaN(value) ? null : value;
      }
    }

    if (dialog.context) {
      dialog.context.dc = typeof pf2ecac_counteractDc === "number"
        ? { value: pf2ecac_counteractDc }
        : undefined;
    }
  }, { capture: true });

  resetButton?.addEventListener("click", () => {
    if (sourceInput) {
      sourceInput.value = pf2ecac_counteractOriginalSourceRank ?? "";
    }
    if (targetInput) {
      targetInput.value = pf2ecac_counteractOriginalTargetRank ?? "";
    }
    if (dcInput) {
      dcInput.value = pf2ecac_counteractOriginalDc ?? "";
    }
  });

  dialog.setPosition();
}

async function pf2ecac_onPTCButtonClick(event) {
  const repostIcon = event.target.closest("i[data-pf2-repost]");
  if (!repostIcon) return;

  const wrapper = repostIcon.closest(".pf2e-inline-button");
  if (!wrapper) return;

  const clone = wrapper.cloneNode(true);

  const actor = pf2ecac_getActor();

  const roll_mode = pf2ecac_getRollMode(event);

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: clone.outerHTML,
    blind: roll_mode === "blindroll" || roll_mode === "blind",
    whisper: roll_mode === "blindroll" || roll_mode === "blind" ? game.users.filter(u => u.isGM).map(u => u.id) : []
  });
}

function pf2ecac_generateCounteractMessage(degree, sourceRank, dcProvided, targetRank, showDC) {
  const texts = {
    success: "You successfully counteract the target!",
    fail: "You fail to counteract the target.",
    failRank: "Counteract failed due to target's higher rank."
  };

  const failText = showDC ? texts.failRank : texts.fail;
  
  const hasSource = sourceRank !== null;
  const hasTarget = targetRank !== null;

  function successCheck(deg) {
    if (hasSource && hasTarget) {
      if (deg === 3) return targetRank <= sourceRank + 3;
      if (deg === 2) return targetRank <= sourceRank + 1;
      if (deg === 1) return targetRank < sourceRank;
      return false;
    }
    return null;
  }

  function conditionText(deg) {
    if (hasSource && hasTarget) {
      if (deg === 0) return texts.fail;
      return successCheck(deg) ? texts.success : failText;
    }

    if (!hasSource && !hasTarget) {
      if (deg === 3) return "You counteract the target if its counteract rank is no more than 3 higher than yours.";
      if (deg === 2) return "You counteract the target if its counteract rank is no more than 1 higher than yours.";
      if (deg === 1) return "You counteract the target if its counteract rank is lower than yours.";
      return texts.fail;
    }

    if (!hasSource && hasTarget) {
      if (deg === 3) return `You counteract the target if your counteract rank is ${targetRank - 3} or more.`;
      if (deg === 2) return `You counteract the target if your counteract rank is ${targetRank - 1} or more.`;
      if (deg === 1) return `You counteract the target if your counteract rank is ${targetRank + 1} or more.`;
      return texts.fail;
    }

    if (hasSource && !hasTarget) {
      if (deg === 3) return `You counteract the target if its counteract rank is ${sourceRank + 3} or less.`;
      if (deg === 2) return `You counteract the target if its counteract rank is ${sourceRank + 1} or less.`;
      if (deg === 1) return `You counteract the target if its counteract rank is ${sourceRank - 1} or less.`;
      return texts.fail;
    }
  }

  function result(deg) {
    if (deg === 0) return texts.fail;
    const check = successCheck(deg);
    if (check === null) return conditionText(deg);
    return check ? texts.success : failText;
  }

  if (dcProvided) {
    return `<strong>Counteract Result </strong>${result(degree)}`;
  }

  return `
    <strong>Critical Success</strong> ${conditionText(3)}<br>
    <hr><strong>Success</strong> ${conditionText(2)}<br>
    <hr><strong>Failure</strong> ${conditionText(1)}<br>
    <hr><strong>Critical Failure</strong> ${texts.fail}
  `;
}

function pf2ecac_registerCounteractInLine() {
  const pattern = /@Counteract\[(.+?)\](?:\{(.+?)\})?/g;

  const enricher = async (match, options) => {
    const args = match[1];
    const label = match[2] ?? "Counteract";

    const parsedArgs = args.split("|").reduce((acc, part) => {
      const trimmed = part.trim();
      if (!trimmed) return acc;
      const [key, ...rest] = trimmed.split(":");
      if (rest.length === 0) {
        acc[key.trim()] = true;
        return acc;
      }
      acc[key.trim()] = rest.join(":").trim();
      return acc;
    }, {});

    if (options?.rollData?.item?.system?.traits?.value) {
      parsedArgs.__itemTraits = options.rollData.item.system.traits.value.join(",");
    }

    const requiredKeys = ["mod"];
    for (const key of requiredKeys) {
      if (!(key in parsedArgs)) {
        return document.createTextNode(`Invalid Counteract syntax: missing "${key}"`);
      }
    }

    const modPattern = /^(skill|lore|save|spell|class|class-spell|perception|number)(:[a-zA-Z0-9_-]+)?$/;
    if (!modPattern.test(parsedArgs.mod)) {
      return document.createTextNode(`Invalid mod syntax: "${parsedArgs.mod}"`);
    }

    if (parsedArgs["source-rank"] === "item-level") {
      const itemLevel = options?.rollData?.item?.level;
      if (itemLevel !== undefined) {
        parsedArgs.__itemLevel = itemLevel;
      }
    }

    if (parsedArgs["source-rank"] === "spell-rank") {
      const spellRank = options?.rollData?.item?.rank;
      if (spellRank !== undefined) {
        parsedArgs.__spellRank = spellRank;
      }
    }

    const counteractButton = document.createElement("a");

    counteractButton.classList.add(
      "inline-check",
      "counteract-roll"
    );

    counteractButton.dataset.args = JSON.stringify(parsedArgs);
    counteractButton.dataset.label = label;

    if (parsedArgs.traits?.split(",").map(t => t.trim().toLowerCase()).includes("secret")) {
      counteractButton.dataset.pf2Traits = "secret";
    }

    const icon = document.createElement("i");
    icon.classList.add("fa-solid", "fa-redo", "icon");

    const span = document.createElement("span");
    span.classList.add("label");
    span.textContent = label;

    counteractButton.append(icon, span);

    const foundryDoc =
      options?.relativeTo ??
      options?.rollData?.actor ??
      options?.rollData?.item;

    if (!foundryDoc || foundryDoc.isOwner) {
      counteractButton.classList.add("with-repost");
    }

    const repostButtons = counteractButton.querySelectorAll("i[data-pf2-repost]");

    if (repostButtons.length > 0) {
      if (foundryDoc && !foundryDoc.isOwner) {
        for (const button of repostButtons) {
          button.remove();
        }

        counteractButton.classList.remove("with-repost");
      }
    }
    else if (!foundryDoc || foundryDoc.isOwner) {
      const repost = document.createElement("i");

      repost.classList.add(
        "fa-solid",
        "fa-comment",
        "repost"
      );

      repost.dataset.pf2Repost = "";
      repost.title = game.i18n.localize("PF2E.Repost");

      counteractButton.append(repost);
    }

    const wrapper = document.createElement("span");
    wrapper.classList.add("pf2e-inline-button");

    wrapper.append(counteractButton);

    return wrapper;
  };

  CONFIG.TextEditor.enrichers.push({
    pattern,
    enricher,
    priority: 0,
    async: true
  });
}

async function pf2ecac_getLevelBasedDC(levelOrTokenOrActor) {
  const dcByLevel = new Map([
    [-1, 13],
    [0, 14],
    [1, 15],
    [2, 16],
    [3, 18],
    [4, 19],
    [5, 20],
    [6, 22],
    [7, 23],
    [8, 24],
    [9, 26],
    [10, 27],
    [11, 28],
    [12, 30],
    [13, 31],
    [14, 32],
    [15, 34],
    [16, 35],
    [17, 36],
    [18, 38],
    [19, 39],
    [20, 40],
    [21, 42],
    [22, 44],
    [23, 46],
    [24, 48],
    [25, 50],
  ]);

  const level =
    levelOrTokenOrActor?.actor?.system?.details?.level?.value ??
    levelOrTokenOrActor?.system?.details?.level?.value ??
    levelOrTokenOrActor ??
    0;

  return dcByLevel.get(level) ?? 14;
}

function pf2ecac_getRollMode(e) {
  if (e.ctrlKey){
    return pf2ecac_setBlindRoll();
  }
  else {
    if (!game.settings.get("core", "rollMode")) {
      return game.settings.get("core", "messageMode");
    }
    else {
      return game.settings.get("core", "rollMode");
    }
  }
}

function pf2ecac_setBlindRoll(){
  if (!game.settings.get("core", "rollMode")) {
      return "blind";     
    }
    else {
      return "blindroll";
    }
}

function pf2ecac_getRollDialog(e) {
  const skipDialog = e.shiftKey == game.user.settings.showCheckDialogs;
  return skipDialog;
}

function pf2ecac_getSourceToken() {
  return canvas.tokens.controlled[0]?.actor || game.user.character;
}

function pf2ecac_getTargetToken() {
  return game.user.targets.first();
}

function pf2ecac_getActor() {
  const actor = pf2ecac_getSourceToken(); 
  return actor || new Actor({ type: "npc", name: game.user.name });
}

function pf2ecac_capitalizeFirst(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function pf2ecac_getSpellcastingEntry(actor, tradition = "highest") {
  const entries = [...actor.spellcasting.collections.values()]
    .map(c => c.entry)
    .filter(e =>
      e?.type === "spellcastingEntry" &&
      e?.statistic?.dc?.value != null
    );
  const filtered = tradition === "highest"
    ? entries
    : entries.filter(e => e.tradition === tradition);
  if (filtered.length === 0) return null;
  const best = filtered.reduce((highest, current) => {
    return current.statistic.dc.value > highest.statistic.dc.value
      ? current
      : highest;
  });

  if (actor.type === "npc") {
    const npcCounteractModifier = new game.pf2e.Modifier({
      label: "Spell DC Modifier",
      slug: "spell-counteract-modifier",
      type: "untyped",
      modifier: best.statistic.dc.value - 10
    });

    best.statistic.modifiers.push(npcCounteractModifier);

    return {
      tradition: best.tradition,
      statistic: best.statistic,
      dc: best.statistic.dc.value
    };
  }

  return {
    tradition: best.tradition,
    statistic: best.statistic,
    dc: best.statistic.dc.value
  };
}