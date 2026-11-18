using RecordRoom.Api.Application.Services;

namespace RecordRoom.Api.Tests;

public class FullTextSearchConditionTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("  -- / *  ")]
    public void Empty_or_punctuation_only_input_has_no_full_text_condition(string? search) =>
        Assert.Null(FilesService.BuildFullTextCondition(search));

    [Fact]
    public void Plain_terms_become_quoted_prefix_terms_with_or_semantics()
    {
        var condition = FilesService.BuildFullTextCondition("File number / Revenue");

        Assert.Equal("\"File*\" OR \"number*\" OR \"Revenue*\"", condition);
    }

    [Fact]
    public void Duplicate_terms_are_removed_without_case_sensitivity()
    {
        var condition = FilesService.BuildFullTextCondition("Revenue revenue REVENUE");

        Assert.Equal("\"Revenue*\"", condition);
    }

    [Fact]
    public void Full_text_query_is_bounded_to_twelve_terms()
    {
        var condition = FilesService.BuildFullTextCondition(
            "one two three four five six seven eight nine ten eleven twelve thirteen fourteen");

        Assert.Equal(12, condition!.Split(" OR ", StringSplitOptions.None).Length);
        Assert.DoesNotContain("thirteen", condition, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("fourteen", condition, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Query_operators_and_punctuation_cannot_be_injected_into_the_condition()
    {
        var condition = FilesService.BuildFullTextCondition(
            "\"x\" OR 1=1; DROP TABLE Files -- hindi हिन्दी");

        Assert.Equal("\"x*\" OR \"OR*\" OR \"1*\" OR \"DROP*\" OR \"TABLE*\" OR \"Files*\" OR \"hindi*\" OR \"हिन्दी*\"", condition);
        Assert.DoesNotContain("DROP TABLE Files", condition);
        Assert.DoesNotContain(";", condition);
        Assert.DoesNotContain("--", condition);
    }
}
