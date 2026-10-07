import type { SpeechVoiceOption } from '../speech-provider-types.js';

const VOICES = [
  ['Cherry', '芊悦', 'female', '阳光亲切', '明亮、自然的年轻女声'],
  ['Serena', '苏瑶', 'female', '温柔', '柔和亲切的年轻女声'],
  ['Ethan', '晨煦', 'male', '阳光活力', '清朗温暖，略带北方口音'],
  ['Chelsie', '千雪', 'female', '甜美', '软糯娇俏的少女声线'],
  ['Momo', '茉兔', 'female', '俏皮', '爱撒娇、活泼有趣'],
  ['Vivian', '十三', 'female', '傲娇', '可爱、略带小暴躁'],
  ['Moon', '月白', 'male', '帅气', '率性清爽的男声'],
  ['Maia', '四月', 'female', '知性温柔', '知性而柔和'],
  ['Kai', '凯', 'male', '舒缓', '舒适、放松的男声'],
  ['Nofish', '不吃鱼', 'male', '随性', '略带不翘舌口音'],
  ['Bella', '萌宝', 'female', '可爱', '灵动俏皮的少女声'],
  ['Jennifer', '詹妮弗', 'female', '电影质感', '美式英语女声'],
  ['Ryan', '甜茶', 'male', '戏剧感', '富有节奏与张力'],
  ['Katerina', '卡捷琳娜', 'female', '成熟', '韵律丰富的成熟女声'],
  ['Aiden', '艾登', 'male', '年轻', '轻快的美式英语男声'],
  ['Eldric Sage', '沧明子', 'male', '沉稳睿智', '成熟老者声线'],
  ['Mia', '乖小妹', 'female', '温顺', '轻柔乖巧'],
  ['Mochi', '沙小弥', 'male', '童真', '聪明伶俐的少年声'],
  ['Bellona', '燕铮莺', 'female', '豪迈', '洪亮清晰、富有表现力'],
  ['Vincent', '田叔', 'male', '沙哑', '沧桑而豪迈的烟嗓'],
  ['Neil', '阿闻', 'male', '播音', '字正腔圆的新闻播报'],
  ['Seren', '小婉', 'female', '舒缓', '温和放松，适合睡前聆听'],
  ['Andre', '安德雷', 'male', '磁性沉稳', '自然舒适的成熟男声'],
  ['Kiki', '阿清', 'female', '粤语甜美', '活泼亲切的港式女声'],
] as const;

export const alibabaTtsVoices: SpeechVoiceOption[] = VOICES.map(([id, name, gender, style, description]) => ({
  id, name: `${name} (${id})`, gender, style, category: style, description, personalities: [style],
}));

export function alibabaVoicesForModel(model: string): SpeechVoiceOption[] {
  if (model === 'qwen-tts' || model === 'qwen-tts-realtime') {
    return alibabaTtsVoices.filter(voice => ['Cherry', 'Serena', 'Ethan', 'Chelsie'].includes(voice.id));
  }
  if (model.includes('instruct')) {
    return alibabaTtsVoices.filter(voice => !['Jennifer', 'Ryan', 'Katerina', 'Aiden', 'Andre', 'Kiki'].includes(voice.id));
  }
  return alibabaTtsVoices;
}
