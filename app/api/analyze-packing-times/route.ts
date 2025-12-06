import { NextRequest, NextResponse } from 'next/server';
import type { PackingTimeDetail } from '@/types/shipstation';

interface AnalyzeRequest {
  packingTimeDetails: PackingTimeDetail[];
  userName: string;
  boxSize: string;
  goalMinutes?: number;
}

/**
 * POST /api/analyze-packing-times
 * Uses OpenAI to analyze packing time patterns and suggest exclusions
 */
export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeRequest = await request.json();
    const { packingTimeDetails, userName, boxSize, goalMinutes } = body;

    if (!packingTimeDetails || packingTimeDetails.length === 0) {
      return NextResponse.json(
        { error: 'No packing time details provided' },
        { status: 400 }
      );
    }

    // Check if OpenAI API key is configured
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    // Format the data as structured JSON for analysis
    const analysisData = {
      context: {
        workerName: userName,
        boxSize: boxSize,
        goalMinutes: goalMinutes || null,
        totalEntries: packingTimeDetails.length,
      },
      packingTimes: packingTimeDetails.map((detail, index) => ({
        index,
        previousTime: detail.previousTime,
        currentTime: detail.currentTime,
        timeDifferenceMinutes: detail.timeDifferenceMinutes,
        previousBoxSize: detail.previousBoxSize,
        currentBoxSize: detail.currentBoxSize,
        currentlyIncluded: detail.included,
      })),
    };

    // Create a prompt for OpenAI with structured JSON data
    const prompt = `You are analyzing packing time data for a warehouse worker. Your job is to identify patterns and suggest which time differences should be excluded from the average calculation.

Here is the raw data in JSON format:

${JSON.stringify(analysisData, null, 2)}

Analyze this data and provide:
1. Likely breaks (lunch, scheduled breaks around 10 AM, 12 PM, 3 PM, or gaps > 30 minutes)
2. Outliers that seem unusually long (might indicate problematic orders or interruptions)
3. Normal variations that should be included

Return your analysis as JSON with this structure:
{
  "suggestions": [
    {
      "index": 0,
      "action": "exclude" | "include",
      "reason": "Brief explanation (e.g., 'Likely break - 45 min gap at 12:15 PM')",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "summary": "Overall analysis summary",
  "patterns": ["Pattern 1", "Pattern 2"]
}

Focus on entries that are currently included but should be excluded (likely breaks), or entries that are excluded but might actually be valid.`;

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Using mini for cost efficiency
        messages: [
          {
            role: 'system',
            content: 'You are a warehouse operations analyst. Analyze packing time data and provide JSON responses with suggestions for excluding/include time differences.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3, // Lower temperature for more consistent analysis
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', errorText);
      return NextResponse.json(
        { error: `OpenAI API error: ${response.status}` },
        { status: 500 }
      );
    }

    const data = await response.json();
    const analysisText = data.choices[0]?.message?.content;

    if (!analysisText) {
      return NextResponse.json(
        { error: 'No response from OpenAI' },
        { status: 500 }
      );
    }

    // Parse the JSON response
    let analysis;
    try {
      analysis = JSON.parse(analysisText);
    } catch (parseError) {
      // If parsing fails, try to extract JSON from markdown code blocks
      const jsonMatch = analysisText.match(/```json\n([\s\S]*?)\n```/) || analysisText.match(/```\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('Could not parse OpenAI response as JSON');
      }
    }

    return NextResponse.json({
      success: true,
      analysis,
    });
  } catch (error) {
    console.error('Error analyzing packing times:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to analyze packing times',
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

