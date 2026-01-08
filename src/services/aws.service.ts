import { RekognitionClient, IndexFacesCommand, IndexFacesCommandInput, DeleteFacesCommand } from "@aws-sdk/client-rekognition";
import * as fs from 'fs';
import { config } from '../config';

export class AwsRekognitionService {
    private client: RekognitionClient;

    constructor() {
        this.client = new RekognitionClient({
            region: config.aws.region,
            credentials: {
                accessKeyId: config.aws.accessKeyId,
                secretAccessKey: config.aws.secretAccessKey
            }
        });
    }

    /**
     * Elimina un rostro de la colección por su FaceId
     */
    async deleteFace(faceId: string, collectionId: string = config.aws.collectionId) {
        try {
            const command = new DeleteFacesCommand({
                CollectionId: collectionId,
                FaceIds: [faceId]
            });
            await this.client.send(command);
            console.log(`   🗑️ Rostro eliminado de AWS: ${faceId}`);
            return { success: true };
        } catch (error: any) {
            console.error(`   ⚠️ Error eliminando de AWS (${faceId}):`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Indexa un rostro en una colección de AWS Rekognition
     */
    async indexFace(imagePath: string, externalImageId: string, collectionId: string = config.aws.collectionId) {
        try {
            const imageBytes = fs.readFileSync(imagePath);

            const params: IndexFacesCommandInput = {
                CollectionId: collectionId,
                Image: {
                    Bytes: imageBytes
                },
                ExternalImageId: externalImageId,
                DetectionAttributes: ['ALL'],
                QualityFilter: 'AUTO',
                MaxFaces: 1 // Solo nos interesa el rostro principal
            };

            const command = new IndexFacesCommand(params);
            const response = await this.client.send(command);

            if (!response.FaceRecords || response.FaceRecords.length === 0) {
                return { success: false, error: 'No se detectaron rostros' };
            }

            const faceRecord = response.FaceRecords[0];
            return {
                success: true,
                faceId: faceRecord.Face?.FaceId,
                confidence: faceRecord.Face?.Confidence,
                details: faceRecord
            };

        } catch (error: any) {
            console.error(`❌ Error indexando en AWS (${externalImageId}):`, error.message);
            return { success: false, error: error.message };
        }
    }
}
