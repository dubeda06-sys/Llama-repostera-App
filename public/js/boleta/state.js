// Estado del lector de boletas (compartido entre orquestador, imagen, IA y preview).
export const b = {
    img: null,       // HTMLImageElement original
    rot: 0,          // rotación aplicada (0/90/180/270)
    deskew: 0,       // inclinación residual fina en grados
    parsed: [],      // ítems detectados
    total: null,     // TOTAL impreso en la boleta (para cuadre)
    fuente: 'ocr',   // 'ocr' (Tesseract) | 'ia' (Gemini afinó el resultado)
    iaAvisoMostrado: false // evita repetir el aviso "IA no disponible"
};
