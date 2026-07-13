// Lambenti Smart Lighting Survey — Revision 2
//
// Creates a new standalone Google Form. It does not modify or duplicate an
// existing survey.
//
// Setup
// A. Create a project at https://script.google.com/, replace Code.gs with this
//    file, and run createLambentiSurveyRevision2().
// B. Approve the Google Forms permission prompt.
// C. Open View > Logs to copy the Edit URL and Published URL.
// D. In the Google Forms editor, manually insert demo_gif.gif immediately above
//    the existing Lambenti description in the Lambenti Concept section.
//
// This script deliberately does not upload or attach the GIF.

const CONFIG = {
  formTitle: 'Lambenti Smart Lighting Survey — Revision 2',
  formDescription:
    'This survey asks about the aesthetics of your home spaces and your experience with smart lighting. It should take about 3–5 minutes.',
};

function createLambentiSurveyRevision2() {
  let form;

  try {
    form = FormApp.create(CONFIG.formTitle);
    form
      .setDescription(CONFIG.formDescription)
      .setCollectEmail(false)
      .setAllowResponseEdits(false)
      .setLimitOneResponsePerUser(false)
      .setShowLinkToRespondAgain(false)
      .setConfirmationMessage('Thank you — your response has been recorded.');

    try {
      form.setProgressBar(true);
    } catch (error) {
      // Progress bars are optional and unavailable in some Google Workspace
      // configurations; the survey itself remains valid without one.
    }

    addFormQuestions_(form);

    const result = {
      editUrl: form.getEditUrl(),
      publishedUrl: form.getPublishedUrl(),
      formId: form.getId(),
    };
    Logger.log('Lambenti Survey Revision 2 created.');
    Logger.log('Edit URL: ' + result.editUrl);
    Logger.log('Published URL: ' + result.publishedUrl);
    Logger.log('Form ID: ' + result.formId);
    return result;
  } catch (error) {
    throw error;
  }
}

function addFormQuestions_(form) {
  addAestheticQuestions_(form);
  addAdditionalAreaAndDecisionQuestions_(form);
  addSmartLightingQuestions_(form);
}

function addAestheticQuestions_(form) {
  form
    .addScaleItem()
    .setTitle('Q1. On a scale of 1–5, how important is the aesthetic of your living room?')
    .setBounds(1, 5)
    .setLabels('Not at all important', 'Extremely important')
    .setRequired(true);

  form
    .addScaleItem()
    .setTitle('Q2. On a scale of 1–5, how important is the aesthetic of your desk area?')
    .setBounds(1, 5)
    .setLabels('Not at all important', 'Extremely important')
    .setRequired(true);
}

function addAdditionalAreaAndDecisionQuestions_(form) {
  const q3 = form
    .addMultipleChoiceItem()
    .setTitle(
      'Q3. In your home, do you spend a large amount of time engaging in productivity or entertainment activities anywhere other than the two specified areas above?'
    )
    .setRequired(true);

  const q3SpecifyPage = form
    .addPageBreakItem()
    .setTitle('Q3 follow-up')
    .setHelpText('Please tell us where you spend that time.');

  form
    .addParagraphTextItem()
    .setTitle('Q3a. Please specify the other area or areas.')
    .setRequired(true);

  const purchaseDecisionPage = form
    .addPageBreakItem()
    .setTitle('Purchase Decision-Making');

  q3.setChoices([
    q3.createChoice('A. No.', purchaseDecisionPage),
    q3.createChoice('B. Yes.', q3SpecifyPage),
  ]);

  form
    .addMultipleChoiceItem()
    .setTitle('Q4. For any purchase of functional or decorative products for the areas listed above, who has the final say?')
    .setChoiceValues([
      'A. I have the final say.',
      'B. I share the final say with someone else.',
      'C. Someone else has the final say.',
    ])
    .setRequired(true);
}

function addSmartLightingQuestions_(form) {
  const q5 = form
    .addMultipleChoiceItem()
    .setTitle('Q5. Have you purchased smart lighting products for any of these areas?')
    .setChoiceValues([
      'A. No.',
      'B. Yes, mostly for decoration.',
      'C. Yes, mostly for function.',
      'D. Yes, for both decoration and function.',
    ])
    .setRequired(true);

  const smartLightingExperiencePage = form
    .addPageBreakItem()
    .setTitle('Smart Lighting Experience')
    .setHelpText('This section is shown only to people who have purchased smart lighting.');

  form
    .addMultipleChoiceItem()
    .setTitle('Q6. If you answered yes, how often do you use your smart lighting products?')
    .setChoiceValues([
      'A. Daily.',
      'B. Often, but not every day.',
      'C. Not often.',
      'D. Never.',
    ])
    .setRequired(true);

  const q7 = form
    .addCheckboxItem()
    .setTitle('Q7. What do you find memorable about the smart lighting products you have purchased?')
    .setHelpText('Select all that apply.')
    .setChoiceValues([
      'A. Ease of setup.',
      'B. Ease of daily use.',
      'C. Build quality and design.',
      'D. Improved the atmosphere of my space.',
      'E. Cross-platform compatibility (for example, connects to my voice assistant or smart home).',
      'F. Features were valuable (for example, scene setup, music response, or brightness).',
    ])
    .setRequired(true);
  q7.showOtherOption(true);

  const q8 = form
    .addMultipleChoiceItem()
    .setTitle('Q8. What is the most frustrating part about using smart lighting?')
    .setChoiceValues([
      'A. Installation, setup, and use of an app.',
      'B. The supplied remote is not convenient.',
      'C. Voice assistant is not always available (for example, my phone is in a different room).',
      'D. The switch, button, or knob is hard to access.',
    ])
    .setRequired(true);
  q8.showOtherOption(true);

  const conceptPage = form
    .addPageBreakItem()
    .setTitle('Lambenti Concept');
  q5.setChoices([
    q5.createChoice('A. No.', conceptPage),
    q5.createChoice('B. Yes, mostly for decoration.', smartLightingExperiencePage),
    q5.createChoice('C. Yes, mostly for function.', smartLightingExperiencePage),
    q5.createChoice('D. Yes, for both decoration and function.', smartLightingExperiencePage),
  ]);

  form
    .addSectionHeaderItem()
    .setTitle('Lambenti is an easy-to-install backlight kit that allows you to use physical objects on your desk to control your light.');

  form
    .addScaleItem()
    .setTitle('Q9. On a scale of 1–5, how interested would you be in integrating this into your home?')
    .setBounds(1, 5)
    .setLabels('Not at all interested', 'Extremely interested')
    .setRequired(true);

  const q10 = form
    .addCheckboxItem()
    .setTitle('Q10. What concerns do you have about this product?')
    .setHelpText('Select all that apply.')
    .setChoiceValues([
      'A. Price.',
      'B. Installation.',
    ])
    .setRequired(false);
  q10.showOtherOption(true);

  form
    .addParagraphTextItem()
    .setTitle('Q11. What would make this product more appealing to you?')
    .setRequired(false);
}
