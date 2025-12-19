import { NextRequest, NextResponse } from 'next/server';

// Proxy GraphQL requests to case-service
const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || 'http://localhost:3001';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const response = await fetch(`${CASE_SERVICE_URL}/graphql`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error: any) {
        console.error('GraphQL proxy error:', error);
        return NextResponse.json(
            { errors: [{ message: error.message || 'Failed to connect to case service' }] },
            { status: 500 }
        );
    }
}
