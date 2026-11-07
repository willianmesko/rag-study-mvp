export const judgeCalibrationVersion = "2.0";

// Authored synthetic controls. The negative assertions are respectively
// unsupported, directly contradicted, and broader than the cited evidence.
export const judgeCalibrationCases = [
  {
    answer: "The archive opens on Monday. Visitors must bring a passport.",
    passages: ["The archive opens on Monday. Its reading room is on the first floor."],
    expected: [
      { claim: "The archive opens on Monday", support: "archive opens on Monday" },
      { claim: "Visitors must bring a passport", support: null }
    ]
  },
  {
    answer: "O prazo termina na sexta-feira. O envio é gratuito.",
    passages: ["O prazo termina na sexta-feira. A taxa de envio é de dez créditos."],
    expected: [
      { claim: "O prazo termina na sexta-feira", support: "prazo termina na sexta-feira" },
      { claim: "O envio é gratuito", support: null }
    ]
  },
  {
    answer: "Weekend volunteers receive a handbook. All volunteers receive a handbook.",
    passages: ["Weekend volunteers receive a handbook. The policy covers weekend shifts only."],
    expected: [
      { claim: "Weekend volunteers receive a handbook", support: "Weekend volunteers receive a handbook" },
      { claim: "All volunteers receive a handbook", support: null }
    ]
  }
] as const;
