// naver-blog.types.ts
export interface NaverBlogItem {
    title: string;
    link: string;
    description: string;
    bloggerName: string;
    postDate: string; // '20251114' 같은 형식
  }
  
  export interface NaverBlogSearchResult {
    lastBuildDate: string;
    total: number;
    start: number;
    display: number;
    items: NaverBlogItem[];
  }