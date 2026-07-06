// Lambenti PMR Survey — Google Forms deployment script
// How to deploy:
// A. Go to https://script.google.com/ and create a new Apps Script project.
// B. Paste this entire file into Code.gs.
// C. Run createLambentiPmrSurvey(). Approve the Google Forms permission prompt.
// D. Open View > Logs to copy the Edit URL and Published URL.
// E. In Google Forms, connect responses to a Google Sheet before distributing.
//
// This creates a respondent-facing form only. Scoring/segmentation should be done in the exported sheet
// using docs/pmr/lambenti-pmr-schema.csv and docs/pmr/lambenti-pmr-codebook.csv.

const LAMBENTI_PMR_QUESTIONS = [
  {
    "id": "Q1",
    "field": "rent_own_status",
    "section": "Household and living situation",
    "title": "Do you currently rent or own your home?",
    "helper": "",
    "type": "single_select",
    "options": [
      "Rent",
      "Own",
      "Live with family / do not personally rent or own",
      "Student housing / dorm",
      "Other: ______"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q2",
    "field": "home_type",
    "section": "Household and living situation",
    "title": "What type of home do you live in?",
    "helper": "",
    "type": "single_select",
    "options": [
      "Detached house",
      "Semi-detached house",
      "Townhouse",
      "Condo",
      "Apartment",
      "Basement apartment",
      "Shared housing / roommate situation",
      "Other: ______"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q3",
    "field": "household_size",
    "section": "Household and living situation",
    "title": "How many people live in your household, including yourself?",
    "helper": "",
    "type": "single_select",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5+"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q4",
    "field": "decor_control_areas",
    "section": "Household and living situation",
    "title": "Which areas of your living space do you personally have influence over decorating? Select all that apply.",
    "helper": "",
    "type": "multi_select",
    "options": [
      "Bedroom",
      "Desk / workspace",
      "Gaming setup",
      "TV stand / media area",
      "Shelf / display area",
      "Living room",
      "Kitchen",
      "Dining area",
      "Entryway / hallway",
      "Balcony / patio",
      "Entire home",
      "I do not have much control over decorating",
      "Other: ______"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q5",
    "field": "primary_decorator",
    "section": "Decorating authority and purchase decision-making",
    "title": "Who usually puts the most effort into decorating your living space?",
    "helper": "",
    "type": "single_select",
    "options": [
      "Mostly me",
      "Mostly my partner / spouse",
      "Mostly a parent or family member",
      "Mostly a roommate",
      "Shared evenly between multiple people",
      "Nobody puts much effort into decorating",
      "Other: ______"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q6",
    "field": "small_decor_final_say",
    "section": "Decorating authority and purchase decision-making",
    "title": "For small decorative purchases under $150 CAD, who usually has the final say?",
    "helper": "Examples: lamps, LED strips, desk accessories, small decor, shelves, organizers, plants, art, mood lighting.",
    "type": "single_select",
    "options": [
      "Mostly me",
      "Mostly my partner / spouse",
      "Mostly a parent or family member",
      "Mostly a roommate",
      "Shared decision",
      "Depends on the room",
      "I usually avoid buying decorative products",
      "Other: ______"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q7",
    "field": "plugin_product_freedom",
    "section": "Decorating authority and purchase decision-making",
    "title": "How much freedom do you personally have to add small plug-in products to your living space?",
    "helper": "Examples: desk lamps, LED strips, plug-in lighting, cable-managed accessories, small decor.",
    "type": "single_select",
    "options": [
      "Complete freedom",
      "Mostly free, but I may check with someone first",
      "Some freedom, but there are limits",
      "Very limited freedom",
      "Almost no freedom"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q8",
    "field": "installation_comfort",
    "section": "Decorating authority and purchase decision-making",
    "title": "How comfortable are you with basic setup or installation for home products?",
    "helper": "Examples: adhesive strips, hiding wires, plugging in power adapters, cable management, mounting small items.",
    "type": "single_select",
    "options": [
      "Very comfortable",
      "Somewhat comfortable",
      "Neutral",
      "Somewhat uncomfortable",
      "Very uncomfortable"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q9",
    "field": "aesthetic_importance_1_10",
    "section": "Aesthetic importance",
    "title": "On a scale of 1–10, how important is the beauty, mood, and aesthetic of your living space to you?",
    "helper": "1 = Not important at all; 10 = Extremely important.",
    "type": "rating_1_10",
    "options": [],
    "scale": "1 2 3 4 5 6 7 8 9 10",
    "grid_rows": null
  },
  {
    "id": "Q10",
    "field": "area_aesthetic_importance",
    "section": "Aesthetic importance",
    "title": "How important is the aesthetic of each of these areas to you?",
    "helper": "Use a 1–10 rating for each: Bedroom, Desk / workspace, Gaming setup, TV stand / media area, Shelf / display area, Living room. If the form feels too long, replace with: Select the areas where aesthetics matter most to you.",
    "type": "matrix_rating_1_10",
    "options": [],
    "scale": "1 2 3 4 5 6 7 8 9 10",
    "grid_rows": [
      "Bedroom",
      "Desk / workspace",
      "Gaming setup",
      "TV stand / media area",
      "Shelf / display area",
      "Living room"
    ]
  },
  {
    "id": "Q11",
    "field": "other_atmospheric_areas",
    "section": "Aesthetic importance",
    "title": "Are there any other areas of your home that you put effort into making beautiful or atmospheric?",
    "helper": "",
    "type": "single_select_with_text",
    "options": [
      "No",
      "Yes"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q12",
    "field": "living_space_mindset",
    "section": "Aesthetic importance",
    "title": "Which statement best describes how you think about your living space?",
    "helper": "",
    "type": "single_select",
    "options": [
      "I mostly care that it is functional",
      "I care somewhat about how it looks, but it is not a major priority",
      "I care about both function and appearance",
      "I put active effort into making my space feel beautiful, cozy, or atmospheric",
      "My living space is a major form of personal expression for me"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q13",
    "field": "bought_lighting_24m",
    "section": "Lighting purchase history",
    "title": "In the past 24 months, have you bought any lighting product for your home, apartment, bedroom, desk, TV area, gaming setup, patio, or workspace?",
    "helper": "Examples include light bulbs, lamps, smart lights, LED strips, TV backlights, under-cabinet lights, ceiling fixtures, wall lights, outdoor lights, or lighting accessories.",
    "type": "single_select",
    "options": [
      "Yes",
      "No",
      "Not sure / I may have bought something minor, like bulbs only"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q14",
    "field": "lighting_products_bought_24m",
    "section": "Lighting purchase history",
    "title": "Which of these lighting products have you bought for your home in the past 24 months? Select all that apply.",
    "helper": "",
    "type": "multi_select",
    "options": [
      "Light bulbs or replacement bulbs",
      "Smart bulbs or smart lighting kits",
      "Table lamps or bedside lamps",
      "Desk lamps or monitor lamps",
      "Floor lamps",
      "Ceiling fixtures, pendant lights, chandeliers, or track lights",
      "Recessed lights / pot lights / downlights",
      "Wall lights or sconces",
      "Bathroom or vanity lights",
      "Kitchen, cabinet, closet, or under-cabinet lights",
      "LED strips or adhesive light strips",
      "TV, monitor, gaming, or desk setup backlighting",
      "Decorative, mood, or ambient lighting",
      "Modular wall lights or light panels",
      "String lights, fairy lights, or patio lights",
      "Outdoor, landscape, porch, or security lights",
      "Dimmers, remotes, sensors, hubs, switches, or lighting accessories",
      "DIY lighting parts, controllers, power supplies, diffusers, or LED channels",
      "Other: ______",
      "I have not bought any lighting products in the past 24 months"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q15",
    "field": "lighting_purchase_reason",
    "section": "Lighting purchase history",
    "title": "What was the main reason you bought lighting? Select the closest answer.",
    "helper": "",
    "type": "single_select",
    "options": [
      "To replace a broken or old bulb / fixture",
      "To make a room brighter or more functional",
      "To improve the mood or atmosphere of a space",
      "To make a desk, TV area, gaming setup, or bedroom look better",
      "To add smart-home control or automation",
      "For renovation or home improvement",
      "For outdoor, patio, or security use",
      "For seasonal decoration",
      "Other: ______",
      "I have not bought lighting in the past 24 months"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q16",
    "field": "most_memorable_lighting_product",
    "section": "Lighting purchase history",
    "title": "Which of the lighting products you bought felt most memorable or satisfying?",
    "helper": "",
    "type": "open_text",
    "options": [],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q17",
    "field": "memorable_product_reason",
    "section": "Lighting purchase history",
    "title": "Why was that product memorable or satisfying? Select all that apply.",
    "helper": "",
    "type": "multi_select",
    "options": [
      "It made the space look better",
      "It changed the mood of the room",
      "It was useful or practical",
      "It felt premium or well-designed",
      "It was fun or satisfying to use",
      "It was smart / automated / app-controlled",
      "It solved a specific problem",
      "Other: ______",
      "Not applicable / I did not buy lighting"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q18",
    "field": "lighting_retailers_24m",
    "section": "Where people buy lighting",
    "title": "If you bought lighting products in the past 24 months, where did you buy them? Select all that apply.",
    "helper": "",
    "type": "multi_select",
    "options": [
      "Amazon",
      "IKEA",
      "Walmart",
      "Costco",
      "Home Depot",
      "Lowe’s / RONA",
      "Canadian Tire",
      "Best Buy",
      "Wayfair",
      "A lighting or furniture store",
      "A brand’s own website",
      "TikTok Shop / Instagram / social media shop",
      "Other online store: ______",
      "Other physical store: ______",
      "I do not remember",
      "Not applicable / I did not buy lighting"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q19",
    "field": "top_of_mind_lighting_retailer",
    "section": "Where people buy lighting",
    "title": "Which store or website do you remember most clearly for lighting or home-decor purchases?",
    "helper": "",
    "type": "open_text",
    "options": [],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q20",
    "field": "max_space_improvement_spend_24m",
    "section": "Spending behavior",
    "title": "In the past 24 months, what is the most you have spent on a single product to improve the look, comfort, or atmosphere of your living space?",
    "helper": "Examples: lighting, desk accessories, decor, shelves, plants, organizers, small furniture, wall art.",
    "type": "single_select",
    "options": [
      "$0–49 CAD",
      "$50–99 CAD",
      "$100–199 CAD",
      "$200–399 CAD",
      "$400+ CAD"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q21",
    "field": "max_lighting_spend_24m",
    "section": "Spending behavior",
    "title": "In the past 24 months, what is the most you have spent on a single lighting product?",
    "helper": "",
    "type": "single_select",
    "options": [
      "$0 CAD",
      "$1–24 CAD",
      "$25–49 CAD",
      "$50–99 CAD",
      "$100–199 CAD",
      "$200–399 CAD",
      "$400+ CAD",
      "I do not remember"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q22",
    "field": "aesthetic_purchase_frequency",
    "section": "Spending behavior",
    "title": "How often do you buy products mainly because they make your space look or feel better?",
    "helper": "",
    "type": "single_select",
    "options": [
      "Never",
      "Rarely",
      "Sometimes",
      "Often",
      "Very often"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q23",
    "field": "lambenti_interest_1_7",
    "section": "Lambenti concept test",
    "title": "Based on this description, how interested are you in this type of product?",
    "helper": "Imagine a plug-in and stick-on ambient lighting product for a desk, shelf, or TV stand. It sits underneath the visible surface, out-of-sight, and controls a warm or cool white backlight. Instead of using a visible switch, remote, or app, you adjust the brightness by moving a small magnetic object on the surface above it. Visualize a wooden hexagon the size of a large coin with a velvet bottom.",
    "type": "rating_1_7",
    "options": [],
    "scale": "1 2 3 4 5 6 7",
    "grid_rows": null
  },
  {
    "id": "Q24",
    "field": "likely_lambenti_use_places",
    "section": "Lambenti concept test",
    "title": "Where would you be most likely to use a product like this? Select all that apply.",
    "helper": "",
    "type": "multi_select",
    "options": [
      "Desk / workspace",
      "TV stand / media area",
      "Gaming setup",
      "Bedroom",
      "Shelf / display area",
      "Living room",
      "Office",
      "I would not use this",
      "Other: ______"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q25",
    "field": "lambenti_interest_drivers",
    "section": "Lambenti concept test",
    "title": "What interests you most about this type of product? Select up to 3.",
    "helper": "",
    "type": "multi_select_max3",
    "options": [
      "It could make my space look better",
      "It could improve the mood or atmosphere of a room",
      "The magnetic interaction sounds satisfying",
      "It avoids visible buttons, remotes, or apps",
      "It seems unique or novel",
      "It could improve a desk, gaming, or TV setup",
      "It could be a good gift",
      "I like smart or unusual home products",
      "Nothing interests me about it",
      "Other: ______"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q26",
    "field": "lambenti_concerns",
    "section": "Lambenti concept test",
    "title": "What concerns would you have about this type of product? Select all that apply.",
    "helper": "",
    "type": "multi_select",
    "options": [
      "Price",
      "Setup / installation",
      "Cable management",
      "Whether I would actually use it",
      "Whether it would look premium",
      "Whether the magnetic control would feel gimmicky",
      "Durability / reliability",
      "Whether it would fit my space",
      "I do not like ambient lighting",
      "I do not have concerns",
      "Other: ______"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q27",
    "field": "lambenti_price_consideration",
    "section": "Lambenti concept test",
    "title": "At what price would you seriously consider buying this product if it looked premium and worked well?",
    "helper": "",
    "type": "single_select",
    "options": [
      "Under $50 CAD",
      "$50–79 CAD",
      "$80–109 CAD",
      "$110–149 CAD",
      "$150–199 CAD",
      "$200+ CAD",
      "I would not consider buying it"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q28",
    "field": "lambenti_purchase_reaction",
    "section": "Lambenti concept test",
    "title": "Which best describes your reaction?",
    "helper": "",
    "type": "single_select",
    "options": [
      "I would seriously consider buying this",
      "I would be interested, but only at the right price",
      "I like the idea, but I am not sure I would buy it",
      "It is interesting, but probably not for me",
      "I am not interested"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q29",
    "field": "wants_demo_video",
    "section": "Lambenti concept test",
    "title": "Would you want to see a short demo video of how it works?",
    "helper": "",
    "type": "single_select",
    "options": [
      "Yes",
      "Maybe",
      "No"
    ],
    "scale": null,
    "grid_rows": null
  },
  {
    "id": "Q30",
    "field": "concept_improvement_open",
    "section": "Lambenti concept test",
    "title": "Optional: What would make this product more appealing to you?",
    "helper": "",
    "type": "open_text",
    "options": [],
    "scale": null,
    "grid_rows": null
  }
];

function createLambentiPmrSurvey() {
  const form = FormApp.create('Home Lighting and Living Space Survey');
  form.setDescription('This survey asks about home lighting, decor, and living-space preferences. It should take about 5–8 minutes. There are no right or wrong answers. Prices are shown in CAD.');
  form.setCollectEmail(false);
  form.setAllowResponseEdits(false);
  form.setLimitOneResponsePerUser(false);
  form.setShowLinkToRespondAgain(false);
  form.setConfirmationMessage('Thank you — your response has been recorded.');
  try { form.setProgressBar(true); } catch (e) {}

  let currentSection = '';
  LAMBENTI_PMR_QUESTIONS.forEach((q) => {
    if (q.section !== currentSection) {
      currentSection = q.section;
      form.addSectionHeaderItem().setTitle(currentSection);
    }
    addQuestion_(form, q);
  });

  Logger.log('Lambenti PMR survey created.');
  Logger.log('Edit URL: ' + form.getEditUrl());
  Logger.log('Published URL: ' + form.getPublishedUrl());
  return { editUrl: form.getEditUrl(), publishedUrl: form.getPublishedUrl() };
}

function addQuestion_(form, q) {
  const title = q.id + '. ' + q.title;
  const help = q.helper || '';
  const type = q.type;
  const options = (q.options || []).filter(Boolean);

  if (q.id === 'Q11') {
    addQ11ConditionalOtherAreaQuestion_(form, q);
    return;
  }

  if (type === 'single_select' || type === 'single_select_with_text') {
    const item = form.addMultipleChoiceItem().setTitle(title).setRequired(true);
    if (help) item.setHelpText(help);
    const choices = stripOther_(options);
    item.setChoiceValues(choices);
    if (hasOther_(options)) item.showOtherOption(true);
    return;
  }

  if (type === 'multi_select' || type === 'multi_select_max3') {
    const item = form.addCheckboxItem().setTitle(title).setRequired(true);
    if (help) item.setHelpText(help);
    const choices = stripOther_(options);
    item.setChoiceValues(choices);
    if (hasOther_(options)) item.showOtherOption(true);
    if (type === 'multi_select_max3') {
      const validation = FormApp.createCheckboxValidation()
        .requireSelectAtMost(3)
        .setHelpText('Select up to 3 options.')
        .build();
      item.setValidation(validation);
    }
    return;
  }

  if (type === 'rating_1_10') {
    const item = form.addScaleItem().setTitle(title).setBounds(1, 10).setLabels('Not important at all', 'Extremely important').setRequired(true);
    if (help) item.setHelpText(help);
    return;
  }

  if (type === 'rating_1_7') {
    const item = form.addScaleItem().setTitle(title).setBounds(1, 7).setLabels('Not interested at all', 'Extremely interested').setRequired(true);
    if (help) item.setHelpText(help);
    return;
  }

  if (type === 'matrix_rating_1_10') {
    const item = form.addGridItem().setTitle(title).setRows(q.grid_rows || []).setColumns(['1','2','3','4','5','6','7','8','9','10']).setRequired(true);
    if (help) item.setHelpText(help);
    return;
  }

  const item = form.addParagraphTextItem().setTitle(title).setRequired(q.id !== 'Q30');
  if (help) item.setHelpText(help);
}

function addQ11ConditionalOtherAreaQuestion_(form, q) {
  const item = form.addMultipleChoiceItem()
    .setTitle(q.id + '. ' + q.title)
    .setRequired(true);

  const yesDetailsPage = form.addPageBreakItem()
    .setTitle('Q11 follow-up')
    .setHelpText('Because you selected Yes, add the other area or areas you had in mind.');

  form.addParagraphTextItem()
    .setTitle('Q11a. Which other area(s) do you put effort into making beautiful or atmospheric?')
    .setRequired(true);

  const continuePage = form.addPageBreakItem()
    .setTitle('Aesthetic importance continued');

  item.setChoices([
    item.createChoice('No', continuePage),
    item.createChoice('Yes', yesDetailsPage),
  ]);
}

function hasOther_(options) {
  return options.some((x) => /^Other:/i.test(x));
}

function stripOther_(options) {
  return options.filter((x) => !/^Other:/i.test(x));
}
