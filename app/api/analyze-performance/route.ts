import { NextRequest, NextResponse } from 'next/server';
import type { UserSummary } from '@/types/shipstation';

interface AnalyzeRequest {
  userSummaries: UserSummary[];
  startDate: string;
  endDate: string;
  previousPeriodData?: {
    userSummaries: UserSummary[];
    startDate: string;
    endDate: string;
  };
}

/**
 * POST /api/analyze-performance
 * Uses OpenAI to analyze high-level performance data comparing users and time periods
 */
export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeRequest = await request.json();
    const { userSummaries, startDate, endDate, previousPeriodData } = body;

    if (!userSummaries || userSummaries.length === 0) {
      return NextResponse.json(
        { error: 'No user summary data provided' },
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
      currentPeriod: {
        dateRange: {
          start: startDate,
          end: endDate,
        },
        users: userSummaries.map(user => ({
          userName: user.userName,
          totalShipments: user.totalShipments,
          shipmentsPerHour: user.shipmentsPerHour || null,
          shipmentsPerDay: user.shipmentsPerDay || null,
          minutesPerShipment: user.minutesPerShipment || null,
          boxSizeStats: user.boxSizeStats ? Object.entries(user.boxSizeStats).map(([boxSize, stats]) => ({
            boxSize,
            count: stats.count,
            averageTimeMinutes: stats.averageTimeMinutes || null,
            goalMinutes: stats.goalMinutes || null,
            isMeetingGoal: stats.isMeetingGoal || null,
          })) : [],
        })),
      },
      previousPeriod: previousPeriodData ? {
        dateRange: {
          start: previousPeriodData.startDate,
          end: previousPeriodData.endDate,
        },
        users: previousPeriodData.userSummaries.map(user => ({
          userName: user.userName,
          totalShipments: user.totalShipments,
          shipmentsPerHour: user.shipmentsPerHour || null,
          shipmentsPerDay: user.shipmentsPerDay || null,
          minutesPerShipment: user.minutesPerShipment || null,
        })),
      } : null,
    };

    // Create a prompt for OpenAI with structured JSON data
    const prompt = `You are analyzing warehouse performance data. Your job is to provide insights comparing users and identifying trends.

Here is the performance data in JSON format:

${JSON.stringify(analysisData, null, 2)}

Analyze this data and provide:
1. User performance comparison - who performed best/worst and why
2. Day-to-day trends (if previous period data is provided)
3. Box size performance insights - which box sizes are meeting goals, which need improvement
4. Overall patterns and anomalies
5. Actionable recommendations

Return your analysis as JSON with this structure:
{
  "userComparison": {
    "topPerformers": ["user1", "user2"],
    "needsImprovement": ["user1", "user2"],
    "insights": "Summary of user performance differences"
  },
  "trends": {
    "improving": ["user1", "user2"],
    "declining": ["user1", "user2"],
    "insights": "Day-to-day comparison insights"
  },
  "boxSizeInsights": [
    {
      "boxSize": "2/4",
      "status": "performing well" | "needs attention",
      "users": ["user1", "user2"],
      "insight": "Brief explanation"
    }
  ],
  "overallSummary": "High-level summary of the period",
  "recommendations": ["Recommendation 1", "Recommendation 2"]
}`;

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a warehouse operations analyst. Analyze performance data and provide JSON responses with insights comparing users and time periods.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
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
    console.error('Error analyzing performance:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to analyze performance',
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

