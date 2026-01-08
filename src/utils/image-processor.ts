import sharp from 'sharp';

/**
 * Calcula un hash perceptual (dHash - Difference Hash) de una imagen.
 * Este algoritmo es robusto a cambios de escala, aspecto y brillo/rasgo, 
 * ideal para detectar duplicados o imágenes muy similares.
 * 
 * Genera un hash de 64 bits (16 caracteres hexadecimales).
 */
export async function computePhash(imagePath: string): Promise<string> {
    try {
        // Validación básica de tamaño
        const metadata = await sharp(imagePath).metadata();
        if (metadata.size && metadata.size < 1000) {
            // Imagen menor a 1KB, probablemente corrupta o vacía
            throw new Error('Imagen demasiado pequeña (< 1KB)');
        }

        // dHash: Resize a 9x8 (ancho x alto) para obtener 8 diferencias por fila (8 filas) = 64 bits
        const width = 9;
        const height = 8;

        const buffer = await sharp(imagePath)
            .grayscale() // Convertir a escala de grises para ignorar color
            .resize(width, height, { fit: 'fill' }) // Forzar tamaño ignorando aspect ratio
            .raw()
            .toBuffer();

        let binaryString = '';

        // Calcular diferencias entre pixeles adyacentes horizontalmente
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width - 1; x++) {
                const currentPixel = buffer[y * width + x];
                const nextPixel = buffer[y * width + x + 1];

                // Si el pixel izquierdo es más brillante (mayor valor), bit 1
                binaryString += (currentPixel > nextPixel ? '1' : '0');
            }
        }

        // Convertir string binario a hexadecimal (16 caracteres)
        // Dividimos en 4 chunks de 16 bits para evitar problemas de precisión con números muy grandes si JS environment es viejo
        // Aunque BigInt es seguro en ES2020.
        const hexHash = BigInt('0b' + binaryString).toString(16).padStart(16, '0');

        return hexHash;
    } catch (error: any) {
        throw new Error(`Error calculando dHash: ${error.message}`);
    }
}
