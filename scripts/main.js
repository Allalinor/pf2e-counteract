async function pf2ecac_rollCounteractCheck(actor, roll_mode, skip_dialog, label, statistic, counteractRank, targetRank, dc, traits = [], roll_options = [], statKey) {
  const system_domains = statKey === "number" ? [] : statistic.domains;
  const domains = ["check","counteract-check", ...system_domains];
  const options = ["counteract","check:statistic:counteract","check:type:check", ...roll_options, ...traits];

  const showDC = game.settings.get("pf2e", "metagame_showDC");
  const showOutcome = game.settings.get("pf2e", "metagame_showResults");

  const isPlayerOwned = actor.hasPlayerOwner;

  const sourcePart = !showDC && !isPlayerOwned
    ? `<span data-visibility="gm">Source Rank ${counteractRank}</span>`
    : `Source Rank ${counteractRank}`;

  const targetPart = targetRank
    ? (showDC ? ` VS Target Rank ${targetRank}` : ` <span data-visibility="gm">VS Target Rank ${targetRank}</span>`)
    : "";

  const statLabel = statKey === "number" || statistic.label === "Counteract" ? "Spell" : statistic.label;

  let RollLabel;
  if (label === "Counteract") {
    RollLabel = `${label} Check${statLabel ? ` (${statLabel})` : ""}<br>${sourcePart}${targetPart}`;
  } else {
    RollLabel = `${label}${statLabel ? ` (${statLabel} Counteract Check)` : " Counteract Check"}<br>${sourcePart}${targetPart}`;
  }

  if (traits.includes("secret")) {
  roll_mode = "blindroll"
  }

  const rollPromise = new Promise((resolve) => {
    Hooks.once("createChatMessage", (message) => resolve(message));
  });

  const result = await game.pf2e.Check.roll(
    new game.pf2e.CheckModifier(RollLabel, statistic),
    {
      actor,
      type: "check",
      domains,
      dc: dc ? { value: dc } : undefined,
      options,
      traits,
      createMessage: true,
      skipDialog: skip_dialog,
      rollMode: roll_mode
    }
  );

  const message = await rollPromise;
  if (!message) return;

  const counteractMessage = pf2ecac_generateCounteractMessage(result.degreeOfSuccess, counteractRank, !!dc, targetRank, showDC);
  const flavoredCounteract = showOutcome ? counteractMessage : `<span data-visibility="gm">${counteractMessage}</span>`;

  const newFlavor = (message.flavor ?? "") + flavoredCounteract;

  const updateData = { flavor: newFlavor };
  if (roll_mode === "blindroll") {
    updateData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
  }

  await message.update(updateData);
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
  const rollMode = pf2ecac_getRollMode(event);
  const skipDialog = pf2ecac_getRollDialog(event);

  const modParts = args.mod.split(":");
  let statistic;
  let statKey = args.mod;

  switch (modParts[0]) {
    case "skill":
      statKey = modParts[1];
      statistic = actor.skills?.[statKey];
      if (!statistic) {
        ui.notifications.warn(`Skill: '${pf2ecac_capitalizeFirst(statKey)}' not found on actor.`);
        return;
      }
      break;

    case "lore":
      statKey = `${modParts[1]}-lore`;
      statistic = actor.skills?.[statKey];
      if (!statistic) {
        ui.notifications.warn(`Lore: '${pf2ecac_capitalizeFirst(modParts[1])}' not found on actor.`);
        return;
      }
      break;

    case "save":
      statKey = modParts[1];
      statistic = actor.saves?.[statKey];
      if (!statistic) {
        ui.notifications.warn(`Save: '${pf2ecac_capitalizeFirst(statKey)}' not found on actor.`);
        return;
      }
      break;

    case "spell":
      if (modParts[1] === "highest") {
        statKey = "spellCounteract";
        statistic = actor.getStatistic("counteract");
        if (!statistic) {
          ui.notifications.warn(`Spell DC not found on actor.`);
          return;
        }
      } else {
        statKey = "spell";
        statistic = actor.attributes?.spellDC;
        if (!statistic) {
          ui.notifications.warn(`Spell DC not found on actor.`);
          return;
        }
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
      const classDCValue = actor.system.attributes.classDC?.value ?? 0;
      const spellDCValue = actor.system.attributes.spellDC?.value ?? 0;

      statistic = classDCValue >= spellDCValue
        ? actor.classDC
        : actor.getStatistic("counteract");
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
      const modValue = Number(modParts[1]);
      if (isNaN(modValue)) {
        ui.notifications.warn(`Invalid flat modifier: ${args.mod}`);
        return;
      }

      statKey = "number";

      const modifier = new game.pf2e.Modifier({
        label: "Modifer",
        slug: "fixed-number",
        type: "untyped",
        modifier: modValue
      });

      statistic = new game.pf2e.StatisticModifier(label, [modifier]);
      break;
    }

    default:
      ui.notifications.warn(`Unknown modifier type: ${args.mod}`);
      return;
  }

  let sourceRank = args["source-rank"];

  if (sourceRank === "actor-level") {
    sourceRank = Math.ceil(actor.system.details.level.value / 2);
  } else if (sourceRank === "item-level") {
    const itemLevel = Number(args.__itemLevel);
    if (isNaN(itemLevel)) {
      ui.notifications.warn(`Item level not available for counteract.`);
      return;
    }
    sourceRank = Math.ceil(itemLevel / 2);
  } else if (sourceRank === "spell-rank") {
    const spellRank = Number(args.__spellRank);
    if (isNaN(spellRank)) {
      ui.notifications.warn(`Spell rank not available for counteract.`);
      return;
    }
    sourceRank = spellRank;
  } else {
    sourceRank = parseInt(sourceRank);
  }

  let targetRank = null;

  if (args["target-rank"]) {
    if (args["target-rank"] === "actor-level") {
      const targets = [...game.user.targets];

      if (targets.length !== 1) {
        ui.notifications.warn("You must target exactly one creature.");
        targetRank = null;
      } else {
        const targetActor = targets[0].actor;
        if (!targetActor) {
          ui.notifications.warn("Target has no actor.");
          targetRank = null;
        } else {
          targetRank = Math.ceil(targetActor.system.details.level.value / 2);
        }
      }
    } else {
      targetRank = parseInt(args["target-rank"]);
    }
  }

  const dc = args.dc ? parseInt(args.dc) + (args.adjustment ? parseInt(args.adjustment) : 0) : null;
  
  const inlineTraits = args.traits ? args.traits.split(",").map(t => t.trim()) : [];
  const itemTraits = args.__itemTraits ? args.__itemTraits.split(",") : [];
  const traits = [...new Set([...inlineTraits, ...itemTraits])];

  const rollOptions = args["options"] ? args["options"].split(",").map(t => t.trim()) : [];

  const systemOptions = actor.getRollOptions(["all", "dex-skill-check", "str-skill-check"]);
  const allRollOptions = [...new Set([...systemOptions, ...rollOptions])];

  requestAnimationFrame(async () => {
    await pf2ecac_rollCounteractCheck(
      actor,
      rollMode,
      skipDialog,
      label,
      statistic,
      sourceRank,
      targetRank,
      dc,
      traits,
      allRollOptions,
      statKey
    );
  });
}

async function pf2ecac_onPTCButtonClick(event) {
  const repostIcon = event.target.closest("i[data-pf2-repost]");
  if (!repostIcon) return;

  const wrapper = repostIcon.closest(".pf2e-inline-button");
  if (!wrapper) return;

  const clone = wrapper.cloneNode(true);

  await ChatMessage.create({
    user: game.user.id,
    content: clone.outerHTML,
  });
}

function pf2ecac_generateCounteractMessage(degree, sourceRank, dcProvided, targetRank, showDC) {
  const resulttexts = {
    succ: "You successfully counteract the target!",
    fail: "You fail to counteract the target.",
    failrank: "Counteract failed due to target's higher rank."
  };
  
  const thresholds = {
    3: `${sourceRank + 3} or less`,
    2: `${sourceRank + 1} or less`,
    1: `less than ${sourceRank}`,
    0: "You fail to counteract the target."
  };

  const failText = showDC ? resulttexts.failrank : resulttexts.fail;

  if (dcProvided && typeof targetRank === "number") {
    const result = (() => {
      switch (degree) {
        case 3:
          return targetRank <= sourceRank + 3
            ? resulttexts.succ
            : failText;
        case 2:
          return targetRank <= sourceRank + 1
            ? resulttexts.succ
            : failText;
        case 1:
          return targetRank < sourceRank
            ? resulttexts.succ
            : failText;
        default:
          return resulttexts.fail;
      }
    })();

    return `<strong>Counteract Result </strong>${result}`;
  }

  else if (dcProvided && typeof targetRank !== "number") {
    const result = (() => {
      switch (degree) {
        case 3:
          return `You counteract the target if its counteract rank is ${thresholds[3]}.`;
        case 2:
          return `You counteract the target if its counteract rank is ${thresholds[2]}.`;
        case 1:
          return `You counteract the target if its counteract rank is ${thresholds[1]}.`;
        default:
          return `${thresholds[0]}`;
      }
    })();

    return `<strong>Counteract Result </strong>${result}`;
  }

  else if (!dcProvided && typeof targetRank === "number") {
    const cs = targetRank <= sourceRank + 3
      ? resulttexts.succ
      : failText;

    const s = targetRank <= sourceRank + 1
      ? resulttexts.succ
      : failText;

    const f = targetRank < sourceRank
      ? resulttexts.succ
      : failText;

    return `
      <strong>Critical Success</strong> ${cs}<br>
      <hr><strong>Success</strong> ${s}<br>
      <hr><strong>Failure</strong> ${f}<br>
      <hr><strong>Critical Failure</strong> ${resulttexts.fail}
      `;
  }

  else {

    return `
      <strong>Critical Success</strong> You counteract the target if its counteract rank is ${thresholds[3]}.<br>
      <hr><strong>Success</strong> You counteract the target if its counteract rank is ${thresholds[2]}.<br>
      <hr><strong>Failure</strong> You counteract the target if its counteract rank is ${thresholds[1]}.<br>
      <hr><strong>Critical Failure</strong> ${thresholds[0]}
      `;
  }
}

function pf2ecac_registerCounteractInLine() {
  const pattern = /@Counteract\[(.+?)\](?:\{(.+?)\})?/g;

  const enricher = async (match, options) => {
    const args = match[1];
    const label = match[2] ?? "Counteract";

    const parsedArgs = args.split("|").reduce((acc, part) => {
      const [key, ...rest] = part.split(":");
      if (!key || rest.length === 0) return acc;
      acc[key.trim()] = rest.join(":").trim();
      return acc;
    }, {});

    if (options?.rollData?.item?.system?.traits?.value) {
      parsedArgs.__itemTraits = options.rollData.item.system.traits.value.join(",");
    }

    const requiredKeys = ["mod", "source-rank"];
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

    const link = document.createElement("a");
    link.classList.add("inline-check", "counteract-roll", "with-repost");
    link.dataset.args = JSON.stringify(parsedArgs);
    link.dataset.label = label;

    if (parsedArgs.traits?.split(",").map(t => t.trim().toLowerCase()).includes("secret")) {
      link.dataset.pf2Traits = "secret";
    }

    const icon = document.createElement("i");
    icon.className = "fa-solid fa-redo icon";

    const span = document.createElement("span");
    span.classList.add("label");
    span.textContent = label;

    const repost = document.createElement("i");
    repost.classList.add("fa-solid", "fa-comment-alt");
    repost.dataset.pf2Repost = "";
    repost.title = "Post prompt to chat";

    link.append(icon, span, repost);

    const wrapper = document.createElement("span");
    wrapper.classList.add("pf2e-inline-button");
    wrapper.style.display = "inline-flex";
    wrapper.style.alignItems = "center";
    wrapper.style.gap = "0.25em";
    wrapper.append(link);

    return wrapper;
  };

  CONFIG.TextEditor.enrichers.push({
    pattern,
    enricher,
    priority: 0,
    async: true
  });
}

async function pf2ecac_getLevelBasedDC(levelOrToken){
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

const level = (levelOrToken?.actor?.system?.details?.level?.value ?? levelOrToken) ?? 0;

return dcByLevel.get(level) ?? 14;
}

function pf2ecac_getRollMode(e) {
  if (e.ctrlKey) return "blindroll";
  return game.settings.get("core", "rollMode");
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
  actor = pf2ecac_getSourceToken(); 
  return actor || new Actor({ type: "npc", name: game.user.name });
}

function pf2ecac_capitalizeFirst(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

Hooks.once("init", () => {
  pf2ecac_registerCounteractInLine();
});

Hooks.once("ready", () => {
  document.body.addEventListener("click", pf2ecac_onCounteractButtonClick);
  document.body.addEventListener("click", pf2ecac_onPTCButtonClick);
});
